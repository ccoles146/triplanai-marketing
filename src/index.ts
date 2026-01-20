import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { getEnv, validateEnv } from './lib/env';
import { getDb, cleanupExpired, closeDb } from './lib/db';
import { checkHealth as checkOllamaHealth } from './services/ollama';
import { runScan, getTopCandidates } from './handlers/scan';
import { handleTelegramWebhook } from './handlers/webhook';
import {
  setWebhook,
  getWebhookInfo,
  deleteWebhook,
  sendNotification,
} from './services/telegram';
import { listPendingReplies } from './services/rate-limiter';

const app = express();
app.use(express.json());

// Initialize database on startup
getDb();

// Health check
app.get('/health', async (_req, res) => {
  const ollamaHealth = await checkOllamaHealth();
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    ollama: ollamaHealth,
  });
});

// Telegram webhook
app.post('/webhook/telegram', async (req, res) => {
  const env = getEnv();

  // Verify webhook secret
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = await handleTelegramWebhook(req.body);
  res.json(result);
});

// ============================================
// TEST ENDPOINTS
// ============================================

// Manual scan trigger
app.post('/test/scan', async (_req, res) => {
  const env = getEnv();
  const { valid, missing } = validateEnv(env);
  if (!valid) {
    res.status(500).json({ error: 'Missing env vars', missing });
    return;
  }

  // Run scan in background
  runScan().catch((error) => {
    console.error('[test/scan] Error:', error);
  });

  res.json({ status: 'scan_started' });
});

// Get top candidates without posting (dry run)
app.get('/test/candidates', async (_req, res) => {
  const env = getEnv();
  const { valid, missing } = validateEnv(env);
  if (!valid) {
    res.status(500).json({ error: 'Missing env vars', missing });
    return;
  }

  try {
    const candidates = await getTopCandidates(5);
    res.json({
      count: candidates.length,
      candidates: candidates.map((c) => ({
        id: c.id,
        platform: c.platform,
        title: c.title,
        content: c.content.slice(0, 200),
        author: c.authorUsername,
        score: c.relevanceScore,
        engagement: c.engagementScore,
        url: c.url,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List pending replies
app.get('/test/pending', async (_req, res) => {
  try {
    const pending = listPendingReplies();
    res.json({
      count: pending.length,
      pending: pending.map((p) => ({
        postId: p.postId,
        platform: p.reply.platform,
        replyText: p.reply.replyText.slice(0, 100),
        createdAt: new Date(p.reply.createdAt).toISOString(),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send test message to Telegram
app.post('/test/telegram', async (_req, res) => {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    res.status(500).json({ error: 'Telegram not configured' });
    return;
  }

  const success = await sendNotification('🧪 Test message from triplanai-marketing server');
  res.json({ success });
});

// ============================================
// WEBHOOK MANAGEMENT
// ============================================

// Set Telegram webhook
app.post('/webhook/set', async (req, res) => {
  const { url } = req.body as { url?: string };
  const webhookUrl = url || `${req.protocol}://${req.get('host')}/webhook/telegram`;

  const result = await setWebhook(webhookUrl);
  res.json(result);
});

// Get webhook info
app.get('/webhook/info', async (_req, res) => {
  const info = await getWebhookInfo();
  res.json({ info });
});

// Delete webhook
app.post('/webhook/delete', async (_req, res) => {
  const success = await deleteWebhook();
  res.json({ success });
});

// ============================================
// START SERVER
// ============================================

const env = getEnv();
const PORT = env.PORT;

// Schedule scan every 4 hours
cron.schedule('0 */4 * * *', async () => {
  console.log('[cron] Running scheduled scan');
  const { valid, missing } = validateEnv(env);
  if (!valid) {
    console.error(`[cron] Missing required env vars: ${missing.join(', ')}`);
    return;
  }

  try {
    await runScan();
  } catch (error) {
    console.error('[cron] Scan failed:', error);
  }
});

// Schedule cleanup every hour
cron.schedule('0 * * * *', () => {
  console.log('[cron] Running cleanup');
  cleanupExpired();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down');
  closeDb();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down');
  closeDb();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[server] triplanai-marketing running on port ${PORT}`);
  console.log('[server] Cron schedule: 0 */4 * * * (every 4 hours)');

  // Validate env on startup
  const { valid, missing } = validateEnv(env);
  if (!valid) {
    console.warn(`[server] Warning: Missing env vars: ${missing.join(', ')}`);
  }
});
