/**
 * End-to-End Test Suite
 *
 * Tests the complete workflow from scanning content through to approval,
 * but with replies being discarded instead of actually posted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Set up test database
let testDb: Database.Database;

// Mock modules
vi.mock('../lib/db', () => ({
  getDb: () => testDb,
}));

const mockEnv = {
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
  WEBHOOK_URL: 'https://example.com/webhook',
  INSTAGRAM_ACCESS_TOKEN: '',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: '',
  FACEBOOK_PAGE_ID: '',
  FACEBOOK_PAGE_ACCESS_TOKEN: '',
  PEXELS_API_KEY: 'test-pexels-key',
};

vi.mock('../lib/env', () => ({
  getEnv: () => mockEnv,
  loadEnv: () => mockEnv,
  validateEnv: () => ({ valid: true, missing: [] }),
}));

const mockChatImpl = vi.fn();
vi.mock('../services/ollama', () => ({
  chat: (...args: unknown[]) => mockChatImpl(...args),
  checkHealth: () => Promise.resolve({ ok: true }),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { scanReddit, clearTokenCache } from '../scanners/reddit';
import { scanTwitter } from '../scanners/twitter';
import { rankPosts, filterForReply } from '../services/ranking';
import { generateReplies } from '../services/reply-generator';
import {
  sendApprovalRequest,
  decodeCallbackData,
} from '../services/telegram';
import {
  isProcessed,
  markProcessed,
  storePendingReply,
  getPendingReply,
  deletePendingReply,
  canPostToday,
  incrementDailyPostCount,
  canMakeRequest,
  recordRequest,
} from '../services/rate-limiter';
import {
  mockRedditResponses,
  mockTelegramResponses,
  createMockFetchResponse,
} from './mocks';
import type { SocialPost, PendingReply } from '../lib/types';

describe('E2E Tests: Full Workflow with Discard on Approval', () => {
  beforeEach(() => {
    vi.resetAllMocks();  // Reset all mocks including queued mockResolvedValueOnce
    mockFetch.mockReset();  // Ensure fetch mock is fully reset
    clearTokenCache();  // Clear Reddit OAuth token cache between tests

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

  describe('Complete Scan-to-Approval Flow (Dry Run)', () => {
    it('should complete the full workflow: scan → rank → generate → approve → discard', async () => {
      // ===========================================
      // PHASE 1: Scan Reddit and Twitter
      // ===========================================

      // Mock Reddit OAuth
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      // Mock Reddit subreddit responses (4 subreddits: triathlon, Ironman, triathlontraining, cycling)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse({
            data: {
              children: [
                {
                  data: {
                    id: `reddit_post_${i}_1`,
                    title: 'First triathlon coming up - tips needed?',
                    selftext: 'How do I prepare for my first triathlon? Any advice for a beginner?',
                    author: `user_${i}`,
                    subreddit: 'triathlon',
                    permalink: `/r/triathlon/comments/reddit_post_${i}_1/test`,
                    score: 25 + i * 10,
                    created_utc: (Date.now() / 1000) - (i * 3600),
                    num_comments: 10 + i,
                  },
                },
                {
                  data: {
                    id: `reddit_post_${i}_2`,
                    title: 'Race report - finished the race!',
                    selftext: 'Just completed the ironman distance today. It was amazing!',  // No question pattern triggers
                    author: `finisher_${i}`,
                    subreddit: 'triathlon',
                    permalink: `/r/triathlon/comments/reddit_post_${i}_2/report`,
                    score: 100 + i * 5,
                    created_utc: (Date.now() / 1000) - (i * 7200),
                    num_comments: 50 + i,
                  },
                },
              ],
            },
          })
        );
      }

      // Mock Twitter search
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          data: [
            {
              id: 'tweet_1',
              text: 'Any tips for brick workouts? Struggling with the run off the bike 😅 #triathlon #swimbikerun',
              author_id: 'tw_user_1',
              created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
              public_metrics: {
                like_count: 15,
                retweet_count: 5,
                reply_count: 3,
                quote_count: 1,
              },
            },
            {
              id: 'tweet_2',
              text: 'Just signed up for my first 70.3! #ironman #triathlon',
              author_id: 'tw_user_2',
              created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
              public_metrics: {
                like_count: 25,
                retweet_count: 8,
                reply_count: 12,
                quote_count: 2,
              },
            },
          ],
          includes: {
            users: [
              { id: 'tw_user_1', username: 'triathlete_newbie' },
              { id: 'tw_user_2', username: 'ironman_dreamer' },
            ],
          },
          meta: { result_count: 2 },
        })
      );

      // Check rate limits before scanning
      expect(canMakeRequest('reddit')).toBe(true);
      expect(canMakeRequest('twitter')).toBe(true);

      // Scan platforms
      const redditPosts = await scanReddit(mockEnv as any);
      recordRequest('reddit');

      const twitterPosts = await scanTwitter(mockEnv as any);
      recordRequest('twitter');

      // Combine all posts
      const allPosts: SocialPost[] = [...redditPosts, ...twitterPosts];

      expect(allPosts.length).toBeGreaterThan(0);
      console.log(`[E2E] Scanned ${allPosts.length} posts total`);

      // ===========================================
      // PHASE 2: Filter and Rank Posts
      // ===========================================

      // Filter out already processed (none in this test)
      const newPosts = allPosts.filter((p) => !isProcessed(p.id));
      expect(newPosts.length).toBe(allPosts.length);

      // Rank posts by relevance
      const rankedPosts = rankPosts(newPosts, 20);

      // Verify ranking assigned scores
      rankedPosts.forEach((post) => {
        expect(post.relevanceScore).toBeGreaterThanOrEqual(0);
      });

      // Filter for posts worth replying to (questions/help requests)
      const candidates = filterForReply(rankedPosts, 30);

      console.log(`[E2E] Found ${candidates.length} reply candidates`);
      expect(candidates.length).toBeGreaterThan(0);

      // Take top 3 candidates
      const topCandidates = candidates.slice(0, 3);

      // Mark all ranked posts as processed
      for (const post of rankedPosts) {
        markProcessed(post.id);
      }

      // Verify they're now marked as processed
      expect(isProcessed(rankedPosts[0].id)).toBe(true);

      // ===========================================
      // PHASE 3: Generate AI Replies
      // ===========================================

      // Mock Ollama responses for each candidate
      const mockReplies = [
        'Great question about brick workouts! The key is to start with shorter runs (10-15 min) right after cycling. Your legs will adapt over time.',
        'For your first triathlon, focus on finishing rather than competing. Practice transitions and know the course!',
        'The bike-to-run transition is tough at first. Try doing short brick sessions 2x per week.',
      ];

      for (const reply of mockReplies) {
        mockChatImpl.mockResolvedValueOnce(reply);
      }

      const generatedReplies = await generateReplies(topCandidates);

      expect(generatedReplies.length).toBe(Math.min(topCandidates.length, mockReplies.length));

      console.log(`[E2E] Generated ${generatedReplies.length} replies`);

      // Verify reply structure
      generatedReplies.forEach((reply) => {
        expect(reply.postId).toBeDefined();
        expect(reply.replyText).toBeDefined();
        expect(reply.status).toBe('pending');
        expect(reply.originalPost).toBeDefined();
      });

      // ===========================================
      // PHASE 4: Send to Telegram for Approval
      // ===========================================

      const pendingReplies: PendingReply[] = [];

      for (const reply of generatedReplies) {
        // Mock Telegram sendMessage
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse({
            ok: true,
            result: {
              message_id: Math.floor(Math.random() * 100000),
              chat: { id: parseInt(mockEnv.TELEGRAM_CHAT_ID) },
            },
          })
        );

        const result = await sendApprovalRequest(reply);
        expect(result.success).toBe(true);
        expect(result.messageId).toBeDefined();

        // Store pending reply
        const pending: PendingReply = {
          postId: reply.postId,
          platform: reply.platform,
          replyText: reply.replyText,
          originalPostUrl: reply.originalPost.url,
          createdAt: Date.now(),
        };

        storePendingReply(pending);
        pendingReplies.push(pending);

        console.log(`[E2E] Sent approval request for ${reply.postId}, message ID: ${result.messageId}`);
      }

      // Verify all pending replies are stored
      for (const pending of pendingReplies) {
        const retrieved = getPendingReply(pending.postId);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.replyText).toBe(pending.replyText);
      }

      // ===========================================
      // PHASE 5: Simulate Approval (Dry Run - Discard)
      // ===========================================

      // Simulate receiving approval callback from Telegram
      for (const pending of pendingReplies) {
        // Simulate callback data as it would come from Telegram
        const callbackData = `approve:${pending.postId}:${pending.platform}`;
        const decoded = decodeCallbackData(callbackData);

        expect(decoded).not.toBeNull();
        expect(decoded!.action).toBe('approve');
        expect(decoded!.postId).toBe(pending.postId);

        // Check daily limit before "posting"
        expect(canPostToday(pending.platform)).toBe(true);

        // In a real scenario, we would post here
        // For this E2E test, we DISCARD instead of posting
        console.log(`[E2E] DRY RUN: Would have posted reply to ${pending.postId}`);
        console.log(`[E2E] Reply text: "${pending.replyText.substring(0, 50)}..."`);

        // Track that we "would have" posted (for limit tracking)
        incrementDailyPostCount(pending.platform);

        // Mock the Telegram status update calls
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse({ ok: true })
        );
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockTelegramResponses.sendMessage)
        );

        // Clean up - delete pending reply as if it was processed
        deletePendingReply(pending.postId);

        // Verify it's gone
        expect(getPendingReply(pending.postId)).toBeNull();
      }

      // ===========================================
      // PHASE 6: Verify Final State
      // ===========================================

      // All original posts should be marked as processed
      for (const post of rankedPosts) {
        expect(isProcessed(post.id)).toBe(true);
      }

      // No pending replies should remain
      for (const pending of pendingReplies) {
        expect(getPendingReply(pending.postId)).toBeNull();
      }

      // Verify we tracked the posts
      console.log(`[E2E] Dry run complete: ${pendingReplies.length} replies would have been posted`);

      // The workflow completed successfully
      expect(true).toBe(true);
    });

    it('should handle decline action by discarding without posting', async () => {
      // Mock a simple flow with one post
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      const singlePostListing = {
        data: {
          children: [
            {
              data: {
                id: 'decline_test',
                title: 'Wetsuit recommendations?',
                selftext: 'Looking for a good triathlon wetsuit. Any tips?',
                author: 'test_user',
                subreddit: 'triathlon',
                permalink: '/r/triathlon/comments/decline_test/wetsuit',
                score: 30,
                created_utc: Date.now() / 1000 - 1800,
                num_comments: 5,
              },
            },
          ],
        },
      };

      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(singlePostListing)
        );
      }

      // Scan
      const posts = await scanReddit(mockEnv as any);
      const ranked = rankPosts(posts);
      const candidates = filterForReply(ranked, 20);

      expect(candidates.length).toBeGreaterThan(0);

      // Generate reply
      mockChatImpl.mockResolvedValueOnce(
        'I recommend the Orca Equip for beginners. Great value!'
      );

      const replies = await generateReplies(candidates.slice(0, 1));
      const reply = replies[0];

      // Store pending
      storePendingReply({
        postId: reply.postId,
        platform: reply.platform,
        replyText: reply.replyText,
        originalPostUrl: reply.originalPost.url,
        createdAt: Date.now(),
      });

      // Verify it's stored
      expect(getPendingReply(reply.postId)).not.toBeNull();

      // Simulate DECLINE action
      const callbackData = `decline:${reply.postId}:${reply.platform}`;
      const decoded = decodeCallbackData(callbackData);

      expect(decoded!.action).toBe('decline');

      // On decline: just remove from pending, don't track as posted
      deletePendingReply(reply.postId);

      console.log(`[E2E] Declined reply for ${reply.postId}`);

      // Verify cleaned up
      expect(getPendingReply(reply.postId)).toBeNull();
    });

    it('should handle the mark_done action for Instagram posts', async () => {
      // Create a mock Instagram post scenario
      const instagramPending: PendingReply = {
        postId: 'instagram:ig_test_123',
        platform: 'instagram',
        replyText: 'Great training photo! Keep up the hard work! 💪 #triathlon',
        originalPostUrl: 'https://instagram.com/p/ig_test_123',
        createdAt: Date.now(),
      };

      // Store pending
      storePendingReply(instagramPending);
      expect(getPendingReply(instagramPending.postId)).not.toBeNull();

      // Simulate mark_done callback (user manually posted on Instagram)
      const callbackData = `mark_done:${instagramPending.postId}:${instagramPending.platform}`;
      const decoded = decodeCallbackData(callbackData);

      expect(decoded!.action).toBe('mark_done');
      expect(decoded!.platform).toBe('instagram');

      // Mark as done: track the post and clean up
      incrementDailyPostCount('instagram');
      deletePendingReply(instagramPending.postId);

      console.log(`[E2E] Marked Instagram post as done: ${instagramPending.postId}`);

      // Verify state
      expect(getPendingReply(instagramPending.postId)).toBeNull();
    });
  });

  describe('Error Handling in E2E Flow', () => {
    it('should handle Ollama failures gracefully', async () => {
      // Mock Reddit scan
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      const listing = {
        data: {
          children: [
            {
              data: {
                id: 'ollama_fail_test',
                title: 'Training question?',
                selftext: 'How to train for ironman?',
                author: 'user',
                subreddit: 'triathlon',
                permalink: '/r/triathlon/comments/test',
                score: 50,
                created_utc: Date.now() / 1000,
                num_comments: 10,
              },
            },
          ],
        },
      };

      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(createMockFetchResponse(listing));
      }

      const posts = await scanReddit(mockEnv as any);
      const ranked = rankPosts(posts);
      const candidates = filterForReply(ranked, 20);

      // Mock Ollama failure
      mockChatImpl.mockRejectedValue(
        new Error('Ollama connection refused')
      );

      const replies = await generateReplies(candidates);

      // Should return empty array on total failure
      expect(replies).toHaveLength(0);

      console.log('[E2E] Handled Ollama failure gracefully');
    });

    it('should handle Telegram API failures', async () => {
      // Create a pending reply
      mockChatImpl.mockResolvedValueOnce('Test reply');

      const mockPost = {
        id: 'telegram_fail_test',
        platform: 'reddit' as const,
        externalId: 'telegram_fail_test',
        url: 'https://reddit.com/r/triathlon/test',
        authorUsername: 'user',
        content: 'Question?',
        title: 'Test',
        subreddit: 'triathlon',
        engagementScore: 50,
        createdAt: new Date(),
        scannedAt: new Date(),
        relevanceScore: 75,
      };

      const replies = await generateReplies([mockPost]);

      // Mock Telegram failure
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ ok: false, description: 'Chat not found' })
      );

      const result = await sendApprovalRequest(replies[0]);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Reply should still be storable for retry
      storePendingReply({
        postId: replies[0].postId,
        platform: replies[0].platform,
        replyText: replies[0].replyText,
        originalPostUrl: replies[0].originalPost.url,
        createdAt: Date.now(),
      });

      expect(getPendingReply(replies[0].postId)).not.toBeNull();

      console.log('[E2E] Handled Telegram failure, reply stored for retry');
    });
  });

  describe('Rate Limiting in E2E Flow', () => {
    it('should respect daily post limits during approval', async () => {
      // Exhaust the daily limit
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');
      incrementDailyPostCount('reddit');

      expect(canPostToday('reddit')).toBe(false);

      // Create pending replies
      const pendingReplies = [
        {
          postId: 'reddit:rate_limit_1',
          platform: 'reddit' as const,
          replyText: 'Reply 1',
          originalPostUrl: 'https://reddit.com/test1',
          createdAt: Date.now(),
        },
        {
          postId: 'reddit:rate_limit_2',
          platform: 'reddit' as const,
          replyText: 'Reply 2',
          originalPostUrl: 'https://reddit.com/test2',
          createdAt: Date.now(),
        },
      ];

      for (const pending of pendingReplies) {
        storePendingReply(pending);
      }

      // Try to "approve" - should be blocked by daily limit
      let approved = 0;
      for (const pending of pendingReplies) {
        if (canPostToday(pending.platform)) {
          // Would post here
          incrementDailyPostCount(pending.platform);
          deletePendingReply(pending.postId);
          approved++;
        } else {
          console.log(`[E2E] Rate limited: Cannot post to ${pending.platform} today`);
        }
      }

      expect(approved).toBe(0);

      // Pending replies should still be there
      expect(getPendingReply('reddit:rate_limit_1')).not.toBeNull();
      expect(getPendingReply('reddit:rate_limit_2')).not.toBeNull();

      // But Twitter should still be available
      expect(canPostToday('twitter')).toBe(true);
    });
  });
});
