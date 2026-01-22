import { getEnv } from '../lib/env';
import type { GeneratedReply, SocialPlatform, TelegramCallbackData } from '../lib/types';

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

/**
 * Platform emoji mapping
 */
const PLATFORM_EMOJI: Record<SocialPlatform, string> = {
  reddit: '🔴',
  twitter: '🐦',
  instagram: '📸',
};

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Sanitize text for Telegram HTML parsing
 * - Removes HTML comments (<!-- -->)
 * - Removes ALL HTML tags (Telegram will format with its own tags)
 * - Escapes special characters
 */
function sanitizeForTelegram(text: string): string {
  return text
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove ALL HTML tags (including malformed ones)
    .replace(/<[^>]*>/g, '')
    // Escape HTML special characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * Format age in human-readable form
 */
function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * Encode callback data for inline buttons
 */
function encodeCallbackData(data: TelegramCallbackData): string {
  return `${data.action}:${data.postId}:${data.platform}`;
}

/**
 * Decode callback data from inline buttons
 */
export function decodeCallbackData(data: string): TelegramCallbackData | null {
  const parts = data.split(':');
  if (parts.length < 3) return null;

  const [action, ...rest] = parts;
  const platform = rest.pop() as SocialPlatform;
  const postId = rest.join(':'); // Handle postIds that might contain colons

  if (!['approve', 'approve_crosspost', 'decline', 'mark_done'].includes(action)) {
    return null;
  }

  return {
    action: action as TelegramCallbackData['action'],
    postId,
    platform,
  };
}

/**
 * Send a message to Telegram
 */
async function sendMessage(
  chatId: string,
  text: string,
  options: {
    parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    replyMarkup?: object;
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
  } = {}
): Promise<TelegramMessage | null> {
  const env = getEnv();
  const response = await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup,
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      reply_to_message_id: options.replyToMessageId,
    }),
  });

  const result = (await response.json()) as TelegramResponse<TelegramMessage>;

  if (!result.ok) {
    console.error('[telegram] sendMessage failed:', result.description);
    return null;
  }

  return result.result ?? null;
}

/**
 * Send an approval request to Telegram with inline buttons
 */
export async function sendApprovalRequest(
  reply: GeneratedReply
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const env = getEnv();
  const post = reply.originalPost;
  const emoji = PLATFORM_EMOJI[post.platform];

  // Sanitize the reply text to remove HTML comments and unsupported tags
  const sanitizedReply = sanitizeForTelegram(reply.replyText);
  const sanitizedContent = sanitizeForTelegram(post.content);
  const sanitizedTitle = post.title ? sanitizeForTelegram(post.title) : '';

  // Build message text (using HTML for more reliable formatting)
  const message = `${emoji} <b>${post.platform.toUpperCase()} Opportunity</b> (Score: ${post.relevanceScore}/100)

<b>@${post.authorUsername}</b>${post.subreddit ? ` in r/${post.subreddit}` : ''}:
${sanitizedTitle ? `<i>${truncate(sanitizedTitle, 100)}</i>\n` : ''}"${truncate(sanitizedContent, 300)}"

⏱️ Posted: ${formatAge(post.createdAt)}
❤️ Engagement: ${post.engagementScore}
🔗 ${post.url}

━━━━━━━━━━━━━━━

✏️ <b>Draft Reply:</b>
"${sanitizedReply}"

━━━━━━━━━━━━━━━

<i>Generated at ${reply.generatedAt.toISOString()}</i>`;

  // Build inline keyboard
  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: '✅ Reply Only',
          callback_data: encodeCallbackData({
            action: 'approve',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
        {
          text: '✅ Reply + Cross-post',
          callback_data: encodeCallbackData({
            action: 'approve_crosspost',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
      ],
      [
        {
          text: '📋 Mark as Done',
          callback_data: encodeCallbackData({
            action: 'mark_done',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
        {
          text: '❌ Skip',
          callback_data: encodeCallbackData({
            action: 'decline',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
      ],
    ],
  };

  try {
    const result = await sendMessage(env.TELEGRAM_CHAT_ID, message, {
      parseMode: 'HTML',
      replyMarkup: inlineKeyboard,
      disableWebPagePreview: true,
    });

    if (result) {
      return { success: true, messageId: result.message_id.toString() };
    }

    return { success: false, error: 'Failed to send message' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Send an Instagram opportunity (link-based, no auto-post)
 */
export async function sendInstagramOpportunity(
  reply: GeneratedReply
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const env = getEnv();
  const post = reply.originalPost;

  // Sanitize text content
  const sanitizedReply = sanitizeForTelegram(reply.replyText);
  const sanitizedContent = sanitizeForTelegram(post.content);

  const message = `📸 <b>Instagram Opportunity</b> (Score: ${post.relevanceScore}/100)

<b>@${post.authorUsername}</b>:
"${truncate(sanitizedContent, 300)}"

⏱️ Posted: ${formatAge(post.createdAt)}
❤️ Engagement: ${post.engagementScore}

📍 <b>Open post:</b> ${post.url}

━━━━━━━━━━━━━━━

✏️ <b>Suggested Reply:</b>
"${sanitizedReply}"

━━━━━━━━━━━━━━━

<i>Copy the reply above and post it manually on Instagram</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: '✅ Mark as Done',
          callback_data: encodeCallbackData({
            action: 'mark_done',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
        {
          text: '❌ Skip',
          callback_data: encodeCallbackData({
            action: 'decline',
            postId: reply.postId,
            platform: reply.platform,
          }),
        },
      ],
    ],
  };

  try {
    const result = await sendMessage(env.TELEGRAM_CHAT_ID, message, {
      parseMode: 'HTML',
      replyMarkup: inlineKeyboard,
      disableWebPagePreview: false, // Show Instagram preview
    });

    if (result) {
      return { success: true, messageId: result.message_id.toString() };
    }

    return { success: false, error: 'Failed to send message' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Update a message after approval/decline (remove buttons, add status)
 */
export async function updateMessageStatus(
  messageId: string,
  status: 'approved' | 'declined' | 'posted' | 'failed' | 'done' | 'manual',
  details?: string,
  callbackData?: TelegramCallbackData
): Promise<void> {
  const env = getEnv();
  const statusEmoji: Record<string, string> = {
    approved: '✅',
    declined: '❌',
    posted: '🚀',
    failed: '⚠️',
    done: '✅',
    manual: '📝',
  };

  // For manual status, keep a "Mark as Done" button
  let replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | null = null;

  if (status === 'manual' && callbackData) {
    replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '✅ Mark as Done',
            callback_data: encodeCallbackData({
              action: 'mark_done',
              postId: callbackData.postId,
              platform: callbackData.platform,
            }),
          },
          {
            text: '❌ Skip',
            callback_data: encodeCallbackData({
              action: 'decline',
              postId: callbackData.postId,
              platform: callbackData.platform,
            }),
          },
        ],
      ],
    };
  } else {
    // Remove inline keyboard for other statuses
    replyMarkup = { inline_keyboard: [] };
  }

  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      message_id: parseInt(messageId),
      reply_markup: replyMarkup,
    }),
  });

  // Send status update as reply
  const statusText = `${statusEmoji[status]} ${status.charAt(0).toUpperCase() + status.slice(1)}${details ? `: ${details}` : ''}`;

  await sendMessage(env.TELEGRAM_CHAT_ID, statusText, {
    replyToMessageId: parseInt(messageId),
  });
}

/**
 * Answer a callback query (acknowledge button press)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  const env = getEnv();
  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: text || 'Processing...',
    }),
  });
}

/**
 * Set the webhook URL for the Telegram bot
 */
export async function setWebhook(
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  const env = getEnv();
  const response = await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['callback_query'],
    }),
  });

  const result = (await response.json()) as TelegramResponse;

  if (result.ok) {
    return { success: true };
  }

  return { success: false, error: result.description };
}

/**
 * Delete the webhook (for testing/debugging)
 */
export async function deleteWebhook(): Promise<boolean> {
  const env = getEnv();
  const response = await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/deleteWebhook`, {
    method: 'POST',
  });

  const result = (await response.json()) as TelegramResponse;
  return result.ok;
}

/**
 * Get webhook info (for debugging)
 */
export async function getWebhookInfo(): Promise<object | null> {
  const env = getEnv();
  const response = await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  const result = (await response.json()) as TelegramResponse<object>;
  return result.result ?? null;
}

/**
 * Send a simple notification message
 */
export async function sendNotification(message: string): Promise<boolean> {
  const env = getEnv();
  const result = await sendMessage(env.TELEGRAM_CHAT_ID, message);
  return result !== null;
}
