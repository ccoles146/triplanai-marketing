import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Create an in-memory database for testing
let testDb: Database.Database;

// Mock the db module before importing rate-limiter
vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => testDb),
}));

import {
  canMakeRequest,
  recordRequest,
  getRemainingRequests,
  isProcessed,
  markProcessed,
  storePendingReply,
  getPendingReply,
  deletePendingReply,
  listPendingReplies,
  getDailyPostCount,
  incrementDailyPostCount,
  canPostToday,
} from './rate-limiter';
import { createMockPendingReply } from '../test/mocks';

describe('Rate Limiter Service', () => {
  beforeEach(() => {
    // Create fresh in-memory database for each test
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');

    // Initialize schema
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        platform TEXT PRIMARY KEY,
        last_request_at INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_posts (
        post_id TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_replies (
        post_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        reply_text TEXT NOT NULL,
        original_post_url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_counts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    if (testDb) {
      testDb.close();
    }
    vi.clearAllMocks();
  });

  describe('canMakeRequest', () => {
    it('should return true when no previous requests', () => {
      const result = canMakeRequest('reddit');

      expect(result).toBe(true);
    });

    it('should return true when within rate limit', () => {
      // Make a few requests (Reddit allows 60/min)
      for (let i = 0; i < 5; i++) {
        recordRequest('reddit');
      }

      const result = canMakeRequest('reddit');

      expect(result).toBe(true);
    });

    it('should return false when rate limit exceeded', () => {
      // Exhaust the rate limit (Reddit: 60/min)
      for (let i = 0; i < 60; i++) {
        recordRequest('reddit');
      }

      const result = canMakeRequest('reddit');

      expect(result).toBe(false);
    });

    it('should return true when window has expired', () => {
      // Insert expired rate limit
      const expiredTime = Date.now() - 120000; // 2 minutes ago
      testDb.prepare(
        'INSERT INTO rate_limits (platform, last_request_at, request_count, expires_at) VALUES (?, ?, ?, ?)'
      ).run('reddit', expiredTime, 60, expiredTime);

      const result = canMakeRequest('reddit');

      expect(result).toBe(true);
    });

    it('should handle different platform limits', () => {
      // Twitter has stricter limits (15/15min)
      for (let i = 0; i < 15; i++) {
        recordRequest('twitter');
      }

      expect(canMakeRequest('twitter')).toBe(false);

      // Reddit should still be allowed
      expect(canMakeRequest('reddit')).toBe(true);
    });
  });

  describe('recordRequest', () => {
    it('should create new rate limit record', () => {
      recordRequest('reddit');

      const row = testDb.prepare(
        'SELECT * FROM rate_limits WHERE platform = ?'
      ).get('reddit') as { platform: string; request_count: number };

      expect(row).toBeDefined();
      expect(row.request_count).toBe(1);
    });

    it('should increment existing request count', () => {
      recordRequest('reddit');
      recordRequest('reddit');
      recordRequest('reddit');

      const row = testDb.prepare(
        'SELECT request_count FROM rate_limits WHERE platform = ?'
      ).get('reddit') as { request_count: number };

      expect(row.request_count).toBe(3);
    });

    it('should reset count when window expires', () => {
      // Insert expired record
      const expiredTime = Date.now() - 120000;
      testDb.prepare(
        'INSERT INTO rate_limits (platform, last_request_at, request_count, expires_at) VALUES (?, ?, ?, ?)'
      ).run('reddit', expiredTime, 50, expiredTime);

      recordRequest('reddit');

      const row = testDb.prepare(
        'SELECT request_count FROM rate_limits WHERE platform = ?'
      ).get('reddit') as { request_count: number };

      // Should be 1, not 51
      expect(row.request_count).toBe(1);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return full limit when no requests made', () => {
      const remaining = getRemainingRequests('reddit');

      expect(remaining).toBe(60); // Reddit limit
    });

    it('should return correct remaining count', () => {
      for (let i = 0; i < 10; i++) {
        recordRequest('reddit');
      }

      const remaining = getRemainingRequests('reddit');

      expect(remaining).toBe(50);
    });

    it('should return 0 when limit exhausted', () => {
      for (let i = 0; i < 60; i++) {
        recordRequest('reddit');
      }

      const remaining = getRemainingRequests('reddit');

      expect(remaining).toBe(0);
    });

    it('should return full limit for expired window', () => {
      const expiredTime = Date.now() - 120000;
      testDb.prepare(
        'INSERT INTO rate_limits (platform, last_request_at, request_count, expires_at) VALUES (?, ?, ?, ?)'
      ).run('twitter', expiredTime, 15, expiredTime);

      const remaining = getRemainingRequests('twitter');

      expect(remaining).toBe(15); // Full Twitter limit
    });
  });

  describe('isProcessed', () => {
    it('should return false for unprocessed post', () => {
      const result = isProcessed('reddit:abc123');

      expect(result).toBe(false);
    });

    it('should return true for processed post', () => {
      markProcessed('reddit:abc123');

      const result = isProcessed('reddit:abc123');

      expect(result).toBe(true);
    });

    it('should return false for expired processed post', () => {
      // Insert expired record
      const expiredTime = Date.now() - 1000;
      testDb.prepare(
        'INSERT INTO processed_posts (post_id, processed_at, expires_at) VALUES (?, ?, ?)'
      ).run('reddit:expired', Date.now() - 10000, expiredTime);

      const result = isProcessed('reddit:expired');

      expect(result).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('should mark post as processed with default TTL', () => {
      markProcessed('reddit:abc123');

      const row = testDb.prepare(
        'SELECT expires_at FROM processed_posts WHERE post_id = ?'
      ).get('reddit:abc123') as { expires_at: number };

      // Default TTL is 7 days
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(row.expires_at).toBeGreaterThan(Date.now() + sevenDaysMs - 1000);
    });

    it('should mark post with custom TTL', () => {
      markProcessed('reddit:custom', 1); // 1 day TTL

      const row = testDb.prepare(
        'SELECT expires_at FROM processed_posts WHERE post_id = ?'
      ).get('reddit:custom') as { expires_at: number };

      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(row.expires_at).toBeLessThan(Date.now() + 2 * oneDayMs);
    });

    it('should update existing processed post', () => {
      markProcessed('reddit:abc123', 1);
      markProcessed('reddit:abc123', 14); // Update to 14 days

      const row = testDb.prepare(
        'SELECT expires_at FROM processed_posts WHERE post_id = ?'
      ).get('reddit:abc123') as { expires_at: number };

      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      expect(row.expires_at).toBeGreaterThan(Date.now() + fourteenDaysMs - 1000);
    });
  });

  describe('storePendingReply', () => {
    it('should store pending reply', () => {
      const pendingReply = createMockPendingReply();

      storePendingReply(pendingReply);

      const row = testDb.prepare(
        'SELECT * FROM pending_replies WHERE post_id = ?'
      ).get(pendingReply.postId) as { reply_text: string };

      expect(row).toBeDefined();
      expect(row.reply_text).toBe(pendingReply.replyText);
    });

    it('should set 24-hour expiry', () => {
      const pendingReply = createMockPendingReply();

      storePendingReply(pendingReply);

      const row = testDb.prepare(
        'SELECT expires_at FROM pending_replies WHERE post_id = ?'
      ).get(pendingReply.postId) as { expires_at: number };

      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      expect(row.expires_at).toBeGreaterThan(Date.now() + twentyFourHoursMs - 1000);
      expect(row.expires_at).toBeLessThan(Date.now() + twentyFourHoursMs + 1000);
    });

    it('should update existing pending reply', () => {
      const pendingReply = createMockPendingReply();
      storePendingReply(pendingReply);

      const updatedReply = { ...pendingReply, replyText: 'Updated reply text' };
      storePendingReply(updatedReply);

      const row = testDb.prepare(
        'SELECT reply_text FROM pending_replies WHERE post_id = ?'
      ).get(pendingReply.postId) as { reply_text: string };

      expect(row.reply_text).toBe('Updated reply text');
    });
  });

  describe('getPendingReply', () => {
    it('should return pending reply', () => {
      const pendingReply = createMockPendingReply();
      storePendingReply(pendingReply);

      const result = getPendingReply(pendingReply.postId);

      expect(result).not.toBeNull();
      expect(result!.postId).toBe(pendingReply.postId);
      expect(result!.replyText).toBe(pendingReply.replyText);
      expect(result!.platform).toBe(pendingReply.platform);
    });

    it('should return null for non-existent reply', () => {
      const result = getPendingReply('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null for expired reply', () => {
      const expiredTime = Date.now() - 1000;
      testDb.prepare(
        'INSERT INTO pending_replies (post_id, platform, reply_text, original_post_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('expired', 'reddit', 'text', 'url', Date.now() - 10000, expiredTime);

      const result = getPendingReply('expired');

      expect(result).toBeNull();
    });
  });

  describe('deletePendingReply', () => {
    it('should delete pending reply', () => {
      const pendingReply = createMockPendingReply();
      storePendingReply(pendingReply);

      deletePendingReply(pendingReply.postId);

      const result = getPendingReply(pendingReply.postId);
      expect(result).toBeNull();
    });

    it('should handle deleting non-existent reply', () => {
      // Should not throw
      expect(() => deletePendingReply('nonexistent')).not.toThrow();
    });
  });

  describe('listPendingReplies', () => {
    it('should list all pending replies', () => {
      storePendingReply(createMockPendingReply({ postId: 'reddit:1' }));
      storePendingReply(createMockPendingReply({ postId: 'reddit:2' }));
      storePendingReply(createMockPendingReply({ postId: 'reddit:3' }));

      const result = listPendingReplies();

      expect(result).toHaveLength(3);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        storePendingReply(createMockPendingReply({ postId: `reddit:${i}` }));
      }

      const result = listPendingReplies(5);

      expect(result).toHaveLength(5);
    });

    it('should not include expired replies', () => {
      storePendingReply(createMockPendingReply({ postId: 'reddit:valid' }));

      // Insert expired reply directly
      const expiredTime = Date.now() - 1000;
      testDb.prepare(
        'INSERT INTO pending_replies (post_id, platform, reply_text, original_post_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('reddit:expired', 'reddit', 'text', 'url', Date.now() - 10000, expiredTime);

      const result = listPendingReplies();

      expect(result).toHaveLength(1);
      expect(result[0].postId).toBe('reddit:valid');
    });
  });

  describe('getDailyPostCount', () => {
    it('should return 0 when no posts made', () => {
      const count = getDailyPostCount('reddit');

      expect(count).toBe(0);
    });

    it('should return correct count after incrementing', () => {
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');

      const count = getDailyPostCount('reddit');

      expect(count).toBe(2);
    });

    it('should track counts separately per platform', () => {
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('twitter');

      expect(getDailyPostCount('reddit')).toBe(2);
      expect(getDailyPostCount('twitter')).toBe(1);
      expect(getDailyPostCount('instagram')).toBe(0);
    });

    it('should return 0 for expired count', () => {
      const today = new Date().toISOString().split('T')[0];
      const expiredTime = Date.now() - 1000;

      testDb.prepare(
        'INSERT INTO daily_counts (key, count, expires_at) VALUES (?, ?, ?)'
      ).run(`reddit:${today}`, 5, expiredTime);

      const count = getDailyPostCount('reddit');

      expect(count).toBe(0);
    });
  });

  describe('incrementDailyPostCount', () => {
    it('should increment count and return new value', () => {
      const count1 = incrementDailyPostCount('reddit');
      const count2 = incrementDailyPostCount('reddit');
      const count3 = incrementDailyPostCount('reddit');

      expect(count1).toBe(1);
      expect(count2).toBe(2);
      expect(count3).toBe(3);
    });

    it('should set 48-hour expiry', () => {
      incrementDailyPostCount('reddit');

      const today = new Date().toISOString().split('T')[0];
      const row = testDb.prepare(
        'SELECT expires_at FROM daily_counts WHERE key = ?'
      ).get(`reddit:${today}`) as { expires_at: number };

      const fortyEightHoursMs = 48 * 60 * 60 * 1000;
      expect(row.expires_at).toBeGreaterThan(Date.now() + fortyEightHoursMs - 1000);
    });
  });

  describe('canPostToday', () => {
    it('should return true when under limit', () => {
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');

      const result = canPostToday('reddit', 3);

      expect(result).toBe(true);
    });

    it('should return false when at limit', () => {
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');

      const result = canPostToday('reddit', 3);

      expect(result).toBe(false);
    });

    it('should use default limit of 3', () => {
      incrementDailyPostCount('twitter');
      incrementDailyPostCount('twitter');
      incrementDailyPostCount('twitter');

      expect(canPostToday('twitter')).toBe(false);
    });

    it('should return true when no posts made', () => {
      const result = canPostToday('instagram');

      expect(result).toBe(true);
    });
  });
});
