import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanReddit, postRedditReply, postToTriplanaiSubreddit, clearTokenCache } from './reddit';
import { mockRedditResponses, createMockFetchResponse } from '../test/mocks';
import type { Env } from '../lib/env';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Reddit Scanner', () => {
  const mockEnv: Env = {
    PORT: 3000,
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.1:8b',
    REDDIT_CLIENT_ID: 'test-client-id',
    REDDIT_CLIENT_SECRET: 'test-client-secret',
    REDDIT_USERNAME: 'test-username',
    REDDIT_PASSWORD: 'test-password',
    REDDIT_USER_AGENT: 'test-user-agent/1.0',
    TWITTER_BEARER_TOKEN: '',
    TWITTER_API_KEY: '',
    TWITTER_API_SECRET: '',
    TWITTER_ACCESS_TOKEN: '',
    TWITTER_ACCESS_SECRET: '',
    INSTAGRAM_ACCESS_TOKEN: '',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: '',
    FACEBOOK_PAGE_ID: '',
    FACEBOOK_PAGE_ACCESS_TOKEN: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    PEXELS_API_KEY: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();  // Clear Reddit OAuth token cache between tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanReddit', () => {
    it('should fetch and parse posts from subreddits', async () => {
      // Mock OAuth token request
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      // Mock subreddit requests (6 subreddits)
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockRedditResponses.subredditListing)
        );
      }

      const posts = await scanReddit(mockEnv);

      // Should only include valid posts (not spam, not deleted)
      // Each subreddit returns 3 posts but 2 are filtered (spam + deleted)
      expect(posts.length).toBe(6); // 1 valid post × 6 subreddits

      // Verify post structure
      const post = posts[0];
      expect(post.platform).toBe('reddit');
      expect(post.id).toBe('reddit:abc123');
      expect(post.externalId).toBe('abc123');
      expect(post.title).toBe('First triathlon advice needed');
      expect(post.subreddit).toBe('triathlon');
      expect(post.authorUsername).toBe('triathlete_user');
      expect(post.engagementScore).toBe(42); // score(25) + num_comments(17)
      expect(post.relevanceScore).toBe(0); // Set later by ranking
    });

    it('should filter out spam posts', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      const spamOnlyListing = {
        data: {
          children: [
            {
              data: {
                id: 'spam1',
                title: 'Buy now! Amazing deal!',
                selftext: 'Use code SPAM for discount',
                author: 'spammer',
                subreddit: 'triathlon',
                permalink: '/r/triathlon/comments/spam1',
                score: 0,
                created_utc: Date.now() / 1000,
                num_comments: 0,
              },
            },
            {
              data: {
                id: 'spam2',
                title: 'DM for price on wetsuit',
                selftext: 'Link in bio!',
                author: 'seller',
                subreddit: 'triathlon',
                permalink: '/r/triathlon/comments/spam2',
                score: 0,
                created_utc: Date.now() / 1000,
                num_comments: 0,
              },
            },
          ],
        },
      };

      // Return spam for all 6 subreddits
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(spamOnlyListing)
        );
      }

      const posts = await scanReddit(mockEnv);

      expect(posts.length).toBe(0);
    });

    it('should filter out posts from deleted users', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      const deletedUserListing = {
        data: {
          children: [
            {
              data: {
                id: 'del1',
                title: 'Some post',
                selftext: 'Content',
                author: '[deleted]',
                subreddit: 'triathlon',
                permalink: '/r/triathlon/comments/del1',
                score: 10,
                created_utc: Date.now() / 1000,
                num_comments: 5,
              },
            },
          ],
        },
      };

      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(deletedUserListing)
        );
      }

      const posts = await scanReddit(mockEnv);

      expect(posts.length).toBe(0);
    });

    it('should cache OAuth token', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockRedditResponses.subredditListing)
        );
      }

      await scanReddit(mockEnv);

      // OAuth should only be called once (token is cached)
      const oauthCalls = mockFetch.mock.calls.filter((call) =>
        call[0].includes('access_token')
      );
      expect(oauthCalls.length).toBe(1);
    });

    it('should handle OAuth failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'invalid_client' }, false, 401)
      );

      await expect(scanReddit(mockEnv)).rejects.toThrow('Reddit OAuth failed');
    });

    it('should continue scanning other subreddits if one fails', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      // First subreddit fails, rest succeed
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'Not found' }, false, 404)
      );

      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockRedditResponses.subredditListing)
        );
      }

      const posts = await scanReddit(mockEnv);

      // Should have posts from 5 subreddits (1 failed)
      expect(posts.length).toBe(5);
    });

    it('should correctly construct post URL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockRedditResponses.subredditListing)
        );
      }

      const posts = await scanReddit(mockEnv);

      expect(posts[0].url).toBe('https://reddit.com/r/triathlon/comments/abc123/first_triathlon');
    });
  });

  describe('postRedditReply', () => {
    it('should post a comment successfully', async () => {
      // Mock user token request
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      // Mock comment POST
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ json: { data: { things: [] } } })
      );

      const result = await postRedditReply(mockEnv, 'abc123', 'This is a test reply');

      expect(result.success).toBe(true);

      // Verify comment request
      const commentCall = mockFetch.mock.calls[1];
      expect(commentCall[0]).toBe('https://oauth.reddit.com/api/comment');
      expect(commentCall[1].method).toBe('POST');
    });

    it('should fail without username/password', async () => {
      const envWithoutCreds = { ...mockEnv, REDDIT_USERNAME: '', REDDIT_PASSWORD: '' };

      const result = await postRedditReply(envWithoutCreds, 'abc123', 'Test reply');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should handle auth failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'invalid_grant' }, false, 401)
      );

      const result = await postRedditReply(mockEnv, 'abc123', 'Test reply');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Auth failed');
    });

    it('should handle comment posting failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'RATELIMIT' }, false, 429)
      );

      const result = await postRedditReply(mockEnv, 'abc123', 'Test reply');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Comment failed');
    });

    it('should use correct thing_id prefix for posts', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ json: { data: {} } })
      );

      await postRedditReply(mockEnv, 'abc123', 'Test reply');

      const commentCall = mockFetch.mock.calls[1];
      const body = commentCall[1].body as URLSearchParams;
      expect(body.get('thing_id')).toBe('t3_abc123');
    });
  });

  describe('postToTriplanaiSubreddit', () => {
    it('should submit a self post successfully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          json: {
            data: {
              url: 'https://reddit.com/r/triplanai/comments/xyz789/test_post',
            },
          },
        })
      );

      const result = await postToTriplanaiSubreddit(
        mockEnv,
        'Test Post Title',
        'This is the post body with triathlon tips.'
      );

      expect(result.success).toBe(true);
      expect(result.url).toContain('triplanai');

      // Verify submit request
      const submitCall = mockFetch.mock.calls[1];
      expect(submitCall[0]).toBe('https://oauth.reddit.com/api/submit');
      const body = submitCall[1].body as URLSearchParams;
      expect(body.get('sr')).toBe('triplanai');
      expect(body.get('kind')).toBe('self');
    });

    it('should fail without credentials', async () => {
      const envWithoutCreds = { ...mockEnv, REDDIT_USERNAME: '', REDDIT_PASSWORD: '' };

      const result = await postToTriplanaiSubreddit(
        envWithoutCreds,
        'Title',
        'Body'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should handle submit failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockRedditResponses.oauthToken)
      );

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'SUBREDDIT_NOEXIST' }, false, 403)
      );

      const result = await postToTriplanaiSubreddit(
        mockEnv,
        'Title',
        'Body'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Submit failed');
    });
  });
});
