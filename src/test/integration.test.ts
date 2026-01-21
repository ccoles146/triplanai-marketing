import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Set up test database
let testDb: Database.Database;

// Mock modules before importing
vi.mock('../lib/db', () => ({
  getDb: () => testDb,
}));

vi.mock('../lib/env', () => ({
  getEnv: () => ({
    PORT: 3000,
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.1:8b',
    REDDIT_CLIENT_ID: 'test-client-id',
    REDDIT_CLIENT_SECRET: 'test-client-secret',
    REDDIT_USERNAME: 'test-username',
    REDDIT_PASSWORD: 'test-password',
    REDDIT_USER_AGENT: 'test-user-agent',
    TWITTER_BEARER_TOKEN: 'test-bearer',
    TWITTER_API_KEY: 'test-api-key',
    TWITTER_API_SECRET: 'test-api-secret',
    TWITTER_ACCESS_TOKEN: 'test-access-token',
    TWITTER_ACCESS_SECRET: 'test-access-secret',
    TELEGRAM_BOT_TOKEN: 'test-telegram-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    FACEBOOK_PAGE_ID: '',
    FACEBOOK_PAGE_ACCESS_TOKEN: '',
    PEXELS_API_KEY: 'test-pexels-key',
  }),
}));

// Create mock for chat that we can control
const mockChatImpl = vi.fn();
vi.mock('../services/ollama', () => ({
  chat: (...args: unknown[]) => mockChatImpl(...args),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { rankPosts, filterForReply } from '../services/ranking';
import { generateReplies, createGeneratedReply } from '../services/reply-generator';
import { sendApprovalRequest } from '../services/telegram';
import {
  canMakeRequest,
  recordRequest,
  isProcessed,
  markProcessed,
  storePendingReply,
  getPendingReply,
  deletePendingReply,
  canPostToday,
  incrementDailyPostCount,
} from '../services/rate-limiter';
import {
  createMockRedditPost,
  createMockTwitterPost,
  mockTelegramResponses,
  createMockFetchResponse,
} from './mocks';
import type { SocialPost } from '../lib/types';

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh in-memory database
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
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
  });

  describe('Scanning and Ranking Pipeline', () => {
    it('should rank posts by relevance and filter for questions', () => {
      const posts: SocialPost[] = [
        createMockRedditPost({
          id: 'reddit:1',
          title: 'Race report from yesterday',
          content: 'Completed my race and got a personal record.',  // Not a question
          engagementScore: 100,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          title: 'Need help with brick workouts',
          content: 'How do I structure my triathlon brick training? Any tips?',
          engagementScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:3',
          title: 'What wetsuit for ironman?',
          content: 'Beginner here, what wetsuit should I get for my race?',
          engagementScore: 75,
        }),
      ];

      // Rank posts
      const ranked = rankPosts(posts);

      // All should have relevance scores
      expect(ranked.every((p) => p.relevanceScore > 0)).toBe(true);

      // Filter for reply candidates (questions only)
      const candidates = filterForReply(ranked);

      // Should only include questions (posts 2 and 3)
      expect(candidates.length).toBe(2);
      expect(candidates.every((p) => p.content.includes('?'))).toBe(true);
    });

    it('should integrate rate limiting with post processing', () => {
      const posts = [
        createMockRedditPost({ id: 'reddit:1' }),
        createMockRedditPost({ id: 'reddit:2' }),
        createMockRedditPost({ id: 'reddit:3' }),
      ];

      // Check rate limit before processing
      expect(canMakeRequest('reddit')).toBe(true);

      // Process posts and mark as processed
      for (const post of posts) {
        expect(isProcessed(post.id)).toBe(false);
        markProcessed(post.id);
        expect(isProcessed(post.id)).toBe(true);
      }

      // Record the request
      recordRequest('reddit');

      // Subsequent check should still allow (under limit)
      expect(canMakeRequest('reddit')).toBe(true);
    });

    it('should filter out already processed posts', () => {
      // Mark some posts as already processed
      markProcessed('reddit:old1');
      markProcessed('reddit:old2');

      const posts = [
        createMockRedditPost({ id: 'reddit:old1' }),
        createMockRedditPost({ id: 'reddit:old2' }),
        createMockRedditPost({ id: 'reddit:new1' }),
        createMockRedditPost({ id: 'reddit:new2' }),
      ];

      // Filter out processed
      const newPosts = posts.filter((p) => !isProcessed(p.id));

      expect(newPosts).toHaveLength(2);
      expect(newPosts.map((p) => p.id)).toEqual(['reddit:new1', 'reddit:new2']);
    });
  });

  describe('Reply Generation Pipeline', () => {
    it('should generate replies and prepare for Telegram approval', async () => {
      mockChatImpl.mockResolvedValue(
        'Great question! For brick workouts, start with shorter sessions...'
      );

      const post = createMockRedditPost({
        id: 'reddit:test123',
        title: 'Brick workout advice',
        content: 'How should I structure my brick workouts?',
      });

      // Generate reply
      const reply = await createGeneratedReply(post);

      expect(reply.postId).toBe('reddit:test123');
      expect(reply.replyText).toContain('brick workouts');
      expect(reply.status).toBe('pending');

      // Store pending reply
      storePendingReply({
        postId: reply.postId,
        platform: reply.platform,
        replyText: reply.replyText,
        originalPostUrl: reply.originalPost.url,
        createdAt: Date.now(),
      });

      // Verify it can be retrieved
      const pending = getPendingReply(reply.postId);
      expect(pending).not.toBeNull();
      expect(pending!.replyText).toBe(reply.replyText);
    });

    it('should handle the full reply generation flow for multiple posts', async () => {
      mockChatImpl
        .mockResolvedValueOnce('Reply to post 1 about triathlon training')
        .mockResolvedValueOnce('Reply to post 2 about nutrition');

      const posts = [
        createMockRedditPost({
          id: 'reddit:multi1',
          content: 'How to train for triathlon?',
        }),
        createMockRedditPost({
          id: 'reddit:multi2',
          content: 'What should I eat before a race?',
        }),
      ];

      const replies = await generateReplies(posts);

      expect(replies).toHaveLength(2);

      // Store all pending replies
      for (const reply of replies) {
        storePendingReply({
          postId: reply.postId,
          platform: reply.platform,
          replyText: reply.replyText,
          originalPostUrl: reply.originalPost.url,
          createdAt: Date.now(),
        });
      }

      // Verify all can be retrieved
      expect(getPendingReply('reddit:multi1')).not.toBeNull();
      expect(getPendingReply('reddit:multi2')).not.toBeNull();
    });
  });

  describe('Telegram Approval Flow', () => {
    it('should send approval request and handle response', async () => {
      // Mock Telegram API
      mockFetch.mockResolvedValue(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      mockChatImpl.mockResolvedValue('Test reply');

      const post = createMockRedditPost({ id: 'reddit:tg1' });
      const reply = await createGeneratedReply(post);

      // Send to Telegram
      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();

      // Store pending reply
      storePendingReply({
        postId: reply.postId,
        platform: reply.platform,
        replyText: reply.replyText,
        originalPostUrl: reply.originalPost.url,
        createdAt: Date.now(),
      });

      // Simulate approval - delete pending reply
      const pending = getPendingReply(reply.postId);
      expect(pending).not.toBeNull();

      deletePendingReply(reply.postId);
      expect(getPendingReply(reply.postId)).toBeNull();
    });
  });

  describe('Daily Post Limit Integration', () => {
    it('should enforce daily post limits across the workflow', async () => {
      // Simulate posting throughout the day
      expect(canPostToday('reddit')).toBe(true);

      incrementDailyPostCount('reddit');
      expect(canPostToday('reddit')).toBe(true);

      incrementDailyPostCount('reddit');
      expect(canPostToday('reddit')).toBe(true);

      incrementDailyPostCount('reddit');
      expect(canPostToday('reddit')).toBe(false);

      // Different platforms should be independent
      expect(canPostToday('twitter')).toBe(true);
    });

    it('should integrate with approval workflow', async () => {
      mockChatImpl.mockResolvedValue('Test reply');
      mockFetch.mockResolvedValue(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      // Generate multiple replies
      const posts = Array(5)
        .fill(null)
        .map((_, i) =>
          createMockRedditPost({
            id: `reddit:daily${i}`,
            content: 'Triathlon question?',
          })
        );

      const replies = await generateReplies(posts);

      // Store all as pending
      for (const reply of replies) {
        storePendingReply({
          postId: reply.postId,
          platform: reply.platform,
          replyText: reply.replyText,
          originalPostUrl: reply.originalPost.url,
          createdAt: Date.now(),
        });
      }

      // Simulate approving posts (should stop at 3)
      let approved = 0;
      for (const reply of replies) {
        if (canPostToday('reddit')) {
          incrementDailyPostCount('reddit');
          deletePendingReply(reply.postId);
          approved++;
        }
      }

      expect(approved).toBe(3);
      expect(canPostToday('reddit')).toBe(false);
    });
  });

  describe('Cross-Platform Pipeline', () => {
    it('should handle posts from multiple platforms correctly', () => {
      const posts = [
        createMockRedditPost({
          id: 'reddit:cross1',
          title: 'Reddit triathlon question',
          content: 'How do I improve my open water swimming?',
        }),
        createMockTwitterPost({
          id: 'twitter:cross1',
          content: 'Just started triathlon training! Any tips? #triathlon',
        }),
        createMockRedditPost({
          id: 'reddit:cross2',
          title: 'Bike fit advice',
          content: 'Need help with my triathlon bike fit?',
        }),
      ];

      // Rank all together
      const ranked = rankPosts(posts);

      // Should include both platforms
      const platforms = new Set(ranked.map((p) => p.platform));
      expect(platforms.has('reddit')).toBe(true);
      expect(platforms.has('twitter')).toBe(true);

      // Filter for questions
      const candidates = filterForReply(ranked);
      expect(candidates.length).toBeGreaterThan(0);

      // Mark all as processed
      for (const post of ranked) {
        markProcessed(post.id);
      }

      // Verify all marked
      expect(isProcessed('reddit:cross1')).toBe(true);
      expect(isProcessed('twitter:cross1')).toBe(true);
      expect(isProcessed('reddit:cross2')).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should handle partial failures in reply generation', async () => {
      mockChatImpl
        .mockResolvedValueOnce('Success 1')
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce('Success 3');

      const posts = [
        createMockRedditPost({ id: 'reddit:err1' }),
        createMockRedditPost({ id: 'reddit:err2' }),
        createMockRedditPost({ id: 'reddit:err3' }),
      ];

      const replies = await generateReplies(posts);

      // Should have 2 successful replies
      expect(replies).toHaveLength(2);
      expect(replies[0].postId).toBe('reddit:err1');
      expect(replies[1].postId).toBe('reddit:err3');
    });

    it('should handle Telegram API failures gracefully', async () => {
      mockFetch.mockResolvedValue(
        createMockFetchResponse({ ok: false, description: 'Rate limited' })
      );

      mockChatImpl.mockResolvedValue('Test reply');

      const post = createMockRedditPost();
      const reply = await createGeneratedReply(post);

      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(false);

      // Pending reply should still be storable for retry
      storePendingReply({
        postId: reply.postId,
        platform: reply.platform,
        replyText: reply.replyText,
        originalPostUrl: reply.originalPost.url,
        createdAt: Date.now(),
      });

      expect(getPendingReply(reply.postId)).not.toBeNull();
    });
  });
});
