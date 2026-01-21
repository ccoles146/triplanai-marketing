import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanTwitter, postTwitterReply } from './twitter';
import { mockTwitterResponses, createMockFetchResponse } from '../test/mocks';
import type { Env } from '../lib/env';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Twitter Scanner', () => {
  const mockEnv: Env = {
    PORT: 3000,
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.1:8b',
    REDDIT_CLIENT_ID: '',
    REDDIT_CLIENT_SECRET: '',
    REDDIT_USERNAME: '',
    REDDIT_PASSWORD: '',
    REDDIT_USER_AGENT: '',
    TWITTER_BEARER_TOKEN: 'test-bearer-token',
    TWITTER_API_KEY: 'test-api-key',
    TWITTER_API_SECRET: 'test-api-secret',
    TWITTER_ACCESS_TOKEN: 'test-access-token',
    TWITTER_ACCESS_SECRET: 'test-access-secret',
    INSTAGRAM_ACCESS_TOKEN: '',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '',
    FACEBOOK_PAGE_ID: '',
    FACEBOOK_PAGE_ACCESS_TOKEN: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    WEBHOOK_URL: '',
    PEXELS_API_KEY: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanTwitter', () => {
    it('should fetch and parse tweets', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTwitterResponses.recentSearch)
      );

      const posts = await scanTwitter(mockEnv);

      // Should filter out spam (1 valid, 1 spam)
      expect(posts.length).toBe(1);

      const post = posts[0];
      expect(post.platform).toBe('twitter');
      expect(post.id).toBe('twitter:1234567890');
      expect(post.externalId).toBe('1234567890');
      expect(post.authorUsername).toBe('triathlonfan');
      expect(post.content).toBe('Just finished my first brick workout! #triathlon #swimbikerun');
      expect(post.hashtags).toContain('#triathlon');
    });

    it('should calculate engagement score correctly', async () => {
      const customResponse = {
        data: [
          {
            id: '111',
            text: 'Test tweet #triathlon',
            author_id: 'user1',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 10,
              retweet_count: 5,  // × 3 = 15
              reply_count: 3,
              quote_count: 2,   // × 2 = 4
            },
          },
        ],
        includes: {
          users: [{ id: 'user1', username: 'testuser' }],
        },
        meta: { result_count: 1 },
      };

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(customResponse)
      );

      const posts = await scanTwitter(mockEnv);

      // 10 + 15 + 3 + 4 = 32
      expect(posts[0].engagementScore).toBe(32);
    });

    it('should extract hashtags from tweet text', async () => {
      const hashtagResponse = {
        data: [
          {
            id: '222',
            text: 'Training for #Ironman #703 this summer! #triathlon #swimbikerun',
            author_id: 'user2',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 5,
              retweet_count: 1,
              reply_count: 0,
              quote_count: 0,
            },
          },
        ],
        includes: {
          users: [{ id: 'user2', username: 'ironmanfan' }],
        },
        meta: { result_count: 1 },
      };

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(hashtagResponse)
      );

      const posts = await scanTwitter(mockEnv);

      expect(posts[0].hashtags).toEqual(['#Ironman', '#703', '#triathlon', '#swimbikerun']);
    });

    it('should filter out spam tweets', async () => {
      const spamResponse = {
        data: [
          {
            id: 'spam1',
            text: 'Buy now! Use discount code SAVE50 for triathlon gear!',
            author_id: 'spammer',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 0,
              retweet_count: 0,
              reply_count: 0,
              quote_count: 0,
            },
          },
          {
            id: 'spam2',
            text: 'Free shipping on all triathlon products! Link in bio!',
            author_id: 'seller',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 0,
              retweet_count: 0,
              reply_count: 0,
              quote_count: 0,
            },
          },
        ],
        includes: {
          users: [
            { id: 'spammer', username: 'spamaccount' },
            { id: 'seller', username: 'selleraccount' },
          ],
        },
        meta: { result_count: 2 },
      };

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(spamResponse)
      );

      const posts = await scanTwitter(mockEnv);

      expect(posts.length).toBe(0);
    });

    it('should return empty array when no bearer token', async () => {
      const envWithoutToken = { ...mockEnv, TWITTER_BEARER_TOKEN: '' };

      const posts = await scanTwitter(envWithoutToken);

      expect(posts).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty array when no tweets found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          data: null,
          meta: { result_count: 0 },
        })
      );

      const posts = await scanTwitter(mockEnv);

      expect(posts).toEqual([]);
    });

    it('should handle API error gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ errors: [{ message: 'Rate limit exceeded' }] }, false, 429)
      );

      const posts = await scanTwitter(mockEnv);

      expect(posts).toEqual([]);
    });

    it('should construct correct search URL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTwitterResponses.recentSearch)
      );

      await scanTwitter(mockEnv);

      const searchCall = mockFetch.mock.calls[0];
      expect(searchCall[0]).toContain('api.twitter.com/2/tweets/search/recent');
      expect(searchCall[0]).toContain('max_results=20');
      expect(searchCall[0]).toContain('tweet.fields=created_at,public_metrics,author_id');
      expect(searchCall[0]).toContain('expansions=author_id');
    });

    it('should use Bearer token in Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTwitterResponses.recentSearch)
      );

      await scanTwitter(mockEnv);

      const searchCall = mockFetch.mock.calls[0];
      expect(searchCall[1].headers.Authorization).toBe('Bearer test-bearer-token');
    });

    it('should map user IDs to usernames', async () => {
      const response = {
        data: [
          {
            id: 'tweet1',
            text: 'Test #triathlon',
            author_id: 'author_id_123',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 1,
              retweet_count: 0,
              reply_count: 0,
              quote_count: 0,
            },
          },
        ],
        includes: {
          users: [{ id: 'author_id_123', username: 'realusername' }],
        },
        meta: { result_count: 1 },
      };

      mockFetch.mockResolvedValueOnce(createMockFetchResponse(response));

      const posts = await scanTwitter(mockEnv);

      expect(posts[0].authorUsername).toBe('realusername');
      expect(posts[0].url).toContain('realusername');
    });

    it('should handle missing user mapping gracefully', async () => {
      const response = {
        data: [
          {
            id: 'tweet1',
            text: 'Test #triathlon',
            author_id: 'unknown_id',
            created_at: new Date().toISOString(),
            public_metrics: {
              like_count: 1,
              retweet_count: 0,
              reply_count: 0,
              quote_count: 0,
            },
          },
        ],
        includes: {
          users: [], // No user data
        },
        meta: { result_count: 1 },
      };

      mockFetch.mockResolvedValueOnce(createMockFetchResponse(response));

      const posts = await scanTwitter(mockEnv);

      expect(posts[0].authorUsername).toBe('unknown');
    });
  });

  describe('postTwitterReply', () => {
    it('should post a reply tweet successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ data: { id: '999' } })
      );

      const result = await postTwitterReply(
        mockEnv,
        '1234567890',
        'Great brick workout! Keep up the training!'
      );

      expect(result.success).toBe(true);

      // Verify request structure
      const postCall = mockFetch.mock.calls[0];
      expect(postCall[0]).toBe('https://api.twitter.com/2/tweets');
      expect(postCall[1].method).toBe('POST');

      const body = JSON.parse(postCall[1].body);
      expect(body.text).toBe('Great brick workout! Keep up the training!');
      expect(body.reply.in_reply_to_tweet_id).toBe('1234567890');
    });

    it('should fail without API credentials', async () => {
      const envWithoutCreds = { ...mockEnv, TWITTER_API_KEY: '', TWITTER_ACCESS_TOKEN: '' };

      const result = await postTwitterReply(
        envWithoutCreds,
        '123',
        'Test reply'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should include OAuth Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ data: { id: '999' } })
      );

      await postTwitterReply(mockEnv, '123', 'Test');

      const postCall = mockFetch.mock.calls[0];
      expect(postCall[1].headers.Authorization).toContain('OAuth');
      expect(postCall[1].headers.Authorization).toContain('oauth_consumer_key');
      expect(postCall[1].headers.Authorization).toContain('oauth_token');
    });

    it('should handle API error response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(
          { errors: [{ message: 'Duplicate content' }] },
          false,
          403
        )
      );

      const result = await postTwitterReply(mockEnv, '123', 'Duplicate tweet');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tweet failed');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await postTwitterReply(mockEnv, '123', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Exception');
    });
  });
});
