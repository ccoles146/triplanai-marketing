import type { SocialPlatform, PendingReply } from '../lib/types';
import { PLATFORM_RATE_LIMITS } from '../lib/keywords';
import { getDb } from '../lib/db';

/**
 * Check if we can make a request to a platform without hitting rate limits
 */
export function canMakeRequest(platform: SocialPlatform): boolean {
  const db = getDb();
  const limits = PLATFORM_RATE_LIMITS[platform];
  const now = Date.now();

  const row = db.prepare(
    'SELECT last_request_at, request_count, expires_at FROM rate_limits WHERE platform = ?'
  ).get(platform) as { last_request_at: number; request_count: number; expires_at: number } | undefined;

  if (!row || row.expires_at < now) {
    return true;
  }

  // Check if window has expired
  if (now - row.last_request_at > limits.windowSeconds * 1000) {
    return true;
  }

  return row.request_count < limits.requestsPerWindow;
}

/**
 * Record a request to a platform for rate limiting
 */
export function recordRequest(platform: SocialPlatform): void {
  const db = getDb();
  const limits = PLATFORM_RATE_LIMITS[platform];
  const now = Date.now();
  const expiresAt = now + limits.windowSeconds * 1000;

  const row = db.prepare(
    'SELECT last_request_at, request_count, expires_at FROM rate_limits WHERE platform = ?'
  ).get(platform) as { last_request_at: number; request_count: number; expires_at: number } | undefined;

  if (!row || row.expires_at < now || now - row.last_request_at > limits.windowSeconds * 1000) {
    // Start new window
    db.prepare(
      'INSERT OR REPLACE INTO rate_limits (platform, last_request_at, request_count, expires_at) VALUES (?, ?, ?, ?)'
    ).run(platform, now, 1, expiresAt);
  } else {
    // Increment existing
    db.prepare(
      'UPDATE rate_limits SET request_count = request_count + 1 WHERE platform = ?'
    ).run(platform);
  }
}

/**
 * Get remaining requests allowed for a platform
 */
export function getRemainingRequests(platform: SocialPlatform): number {
  const db = getDb();
  const limits = PLATFORM_RATE_LIMITS[platform];
  const now = Date.now();

  const row = db.prepare(
    'SELECT last_request_at, request_count, expires_at FROM rate_limits WHERE platform = ?'
  ).get(platform) as { last_request_at: number; request_count: number; expires_at: number } | undefined;

  if (!row || row.expires_at < now || now - row.last_request_at > limits.windowSeconds * 1000) {
    return limits.requestsPerWindow;
  }

  return Math.max(0, limits.requestsPerWindow - row.request_count);
}

/**
 * Check if a post has already been processed (deduplication)
 */
export function isProcessed(postId: string): boolean {
  const db = getDb();
  const now = Date.now();

  const row = db.prepare(
    'SELECT 1 FROM processed_posts WHERE post_id = ? AND expires_at > ?'
  ).get(postId, now);

  return row !== undefined;
}

/**
 * Mark a post as processed to avoid reprocessing
 */
export function markProcessed(postId: string, ttlDays: number = 7): void {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + ttlDays * 24 * 60 * 60 * 1000;

  db.prepare(
    'INSERT OR REPLACE INTO processed_posts (post_id, processed_at, expires_at) VALUES (?, ?, ?)'
  ).run(postId, now, expiresAt);
}

/**
 * Store a pending reply awaiting approval
 */
export function storePendingReply(reply: PendingReply): void {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours

  db.prepare(
    'INSERT OR REPLACE INTO pending_replies (post_id, platform, reply_text, original_post_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(reply.postId, reply.platform, reply.replyText, reply.originalPostUrl, reply.createdAt, expiresAt);
}

/**
 * Get a pending reply by post ID
 */
export function getPendingReply(postId: string): PendingReply | null {
  const db = getDb();
  const now = Date.now();

  const row = db.prepare(
    'SELECT post_id, platform, reply_text, original_post_url, created_at FROM pending_replies WHERE post_id = ? AND expires_at > ?'
  ).get(postId, now) as {
    post_id: string;
    platform: string;
    reply_text: string;
    original_post_url: string;
    created_at: number;
  } | undefined;

  if (!row) return null;

  return {
    postId: row.post_id,
    platform: row.platform as SocialPlatform,
    replyText: row.reply_text,
    originalPostUrl: row.original_post_url,
    createdAt: row.created_at,
  };
}

/**
 * Delete a pending reply after it's been handled
 */
export function deletePendingReply(postId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pending_replies WHERE post_id = ?').run(postId);
}

/**
 * Get all pending replies (for cleanup or debugging)
 */
export function listPendingReplies(limit: number = 100): { postId: string; reply: PendingReply }[] {
  const db = getDb();
  const now = Date.now();

  const rows = db.prepare(
    'SELECT post_id, platform, reply_text, original_post_url, created_at FROM pending_replies WHERE expires_at > ? LIMIT ?'
  ).all(now, limit) as Array<{
    post_id: string;
    platform: string;
    reply_text: string;
    original_post_url: string;
    created_at: number;
  }>;

  return rows.map((row) => ({
    postId: row.post_id,
    reply: {
      postId: row.post_id,
      platform: row.platform as SocialPlatform,
      replyText: row.reply_text,
      originalPostUrl: row.original_post_url,
      createdAt: row.created_at,
    },
  }));
}

/**
 * Track daily post count per platform (to enforce 1-3 posts/day limit)
 */
export function getDailyPostCount(platform: SocialPlatform): number {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const key = `${platform}:${today}`;
  const now = Date.now();

  const row = db.prepare(
    'SELECT count FROM daily_counts WHERE key = ? AND expires_at > ?'
  ).get(key, now) as { count: number } | undefined;

  return row?.count ?? 0;
}

/**
 * Increment daily post count for a platform
 */
export function incrementDailyPostCount(platform: SocialPlatform): number {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const key = `${platform}:${today}`;
  const now = Date.now();
  const expiresAt = now + 48 * 60 * 60 * 1000; // 48 hours

  const current = getDailyPostCount(platform);
  const newCount = current + 1;

  db.prepare(
    'INSERT OR REPLACE INTO daily_counts (key, count, expires_at) VALUES (?, ?, ?)'
  ).run(key, newCount, expiresAt);

  return newCount;
}

/**
 * Check if we've hit the daily post limit for a platform
 */
export function canPostToday(platform: SocialPlatform, maxPerDay: number = 3): boolean {
  const count = getDailyPostCount(platform);
  return count < maxPerDay;
}
