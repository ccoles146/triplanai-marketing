/**
 * Shared mock data and utilities for tests
 */

import type { SocialPost, GeneratedReply, PendingReply } from '../lib/types';

/**
 * Create a mock Reddit post
 */
export function createMockRedditPost(overrides: Partial<SocialPost> = {}): SocialPost {
  const now = new Date();
  return {
    id: 'reddit:abc123',
    platform: 'reddit',
    externalId: 'abc123',
    url: 'https://reddit.com/r/triathlon/comments/abc123/test',
    authorUsername: 'triathlete_user',
    content: 'I just signed up for my first triathlon. Any tips for a beginner?',
    title: 'First triathlon advice needed',
    subreddit: 'triathlon',
    engagementScore: 42,
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
    scannedAt: now,
    relevanceScore: 0,
    ...overrides,
  };
}

/**
 * Create a mock Twitter post
 */
export function createMockTwitterPost(overrides: Partial<SocialPost> = {}): SocialPost {
  const now = new Date();
  return {
    id: 'twitter:1234567890',
    platform: 'twitter',
    externalId: '1234567890',
    url: 'https://twitter.com/triathlonfan/status/1234567890',
    authorUsername: 'triathlonfan',
    content: 'Just finished my first brick workout! Legs feel like jelly 😅 #triathlon #swimbikerun',
    hashtags: ['#triathlon', '#swimbikerun'],
    engagementScore: 25,
    createdAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 minutes ago
    scannedAt: now,
    relevanceScore: 0,
    ...overrides,
  };
}

/**
 * Create a mock Instagram post
 */
export function createMockInstagramPost(overrides: Partial<SocialPost> = {}): SocialPost {
  const now = new Date();
  return {
    id: 'instagram:ig12345',
    platform: 'instagram',
    externalId: 'ig12345',
    url: 'https://instagram.com/p/ig12345',
    authorUsername: 'tri_enthusiast',
    content: 'Training for my first Ironman! Any nutrition tips? #ironman #triathlon',
    hashtags: ['#ironman', '#triathlon'],
    engagementScore: 150,
    createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago
    scannedAt: now,
    relevanceScore: 0,
    ...overrides,
  };
}

/**
 * Create a mock generated reply
 */
export function createMockGeneratedReply(
  post: SocialPost = createMockRedditPost(),
  overrides: Partial<GeneratedReply> = {}
): GeneratedReply {
  return {
    postId: post.id,
    platform: post.platform,
    originalPost: post,
    replyText: 'Great question! For your first triathlon, focus on consistency over intensity. Start with shorter distances and build up gradually. Good luck!',
    generatedAt: new Date(),
    status: 'pending',
    ...overrides,
  };
}

/**
 * Create a mock pending reply
 */
export function createMockPendingReply(overrides: Partial<PendingReply> = {}): PendingReply {
  return {
    postId: 'reddit:abc123',
    platform: 'reddit',
    replyText: 'This is a test reply for the triathlon post.',
    originalPostUrl: 'https://reddit.com/r/triathlon/comments/abc123/test',
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Mock fetch response helper
 */
export function createMockFetchResponse<T>(data: T, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => createMockFetchResponse(data, ok, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

/**
 * Mock Reddit API responses
 */
export const mockRedditResponses = {
  oauthToken: {
    access_token: 'mock-reddit-token',
    token_type: 'bearer',
    expires_in: 3600,
  },
  subredditListing: {
    data: {
      children: [
        {
          data: {
            id: 'abc123',
            title: 'First triathlon advice needed',
            selftext: 'I just signed up for my first triathlon. Any tips?',
            author: 'triathlete_user',
            subreddit: 'triathlon',
            permalink: '/r/triathlon/comments/abc123/first_triathlon',
            score: 25,
            created_utc: Date.now() / 1000 - 3600,
            num_comments: 17,
          },
        },
        {
          data: {
            id: 'def456',
            title: 'Buy now! Discount triathlon gear!',
            selftext: 'Use code SPAM for $50 off!',
            author: 'spammer123',
            subreddit: 'triathlon',
            permalink: '/r/triathlon/comments/def456/spam',
            score: 0,
            created_utc: Date.now() / 1000 - 7200,
            num_comments: 0,
          },
        },
        {
          data: {
            id: 'ghi789',
            title: 'Post from deleted user',
            selftext: 'Some content',
            author: '[deleted]',
            subreddit: 'triathlon',
            permalink: '/r/triathlon/comments/ghi789/deleted',
            score: 5,
            created_utc: Date.now() / 1000 - 1800,
            num_comments: 2,
          },
        },
      ],
    },
  },
};

/**
 * Mock Twitter API responses
 */
export const mockTwitterResponses = {
  recentSearch: {
    data: [
      {
        id: '1234567890',
        text: 'Just finished my first brick workout! #triathlon #swimbikerun',
        author_id: 'user123',
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        public_metrics: {
          like_count: 15,
          retweet_count: 3,
          reply_count: 2,
          quote_count: 1,
        },
      },
      {
        id: '0987654321',
        text: 'Buy now! Discount code SPAM123 for triathlon gear!',
        author_id: 'spammer456',
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
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
        { id: 'user123', username: 'triathlonfan' },
        { id: 'spammer456', username: 'spammer' },
      ],
    },
    meta: {
      result_count: 2,
    },
  },
};

/**
 * Mock Telegram API responses
 */
export const mockTelegramResponses = {
  sendMessage: {
    ok: true,
    result: {
      message_id: 12345,
      chat: { id: 123456789 },
    },
  },
  editMessageReplyMarkup: {
    ok: true,
  },
  answerCallbackQuery: {
    ok: true,
  },
  setWebhook: {
    ok: true,
  },
  deleteWebhook: {
    ok: true,
  },
  getWebhookInfo: {
    ok: true,
    result: {
      url: 'https://example.com/webhook/telegram',
      has_custom_certificate: false,
      pending_update_count: 0,
    },
  },
};

/**
 * Mock Pexels API responses
 */
export const mockPexelsResponses = {
  searchPhotos: {
    total_results: 100,
    page: 1,
    per_page: 5,
    photos: [
      {
        id: 123,
        width: 1920,
        height: 1080,
        url: 'https://pexels.com/photo/123',
        photographer: 'John Doe',
        photographer_url: 'https://pexels.com/@johndoe',
        photographer_id: 456,
        avg_color: '#ffffff',
        src: {
          original: 'https://images.pexels.com/photos/123/original.jpg',
          large2x: 'https://images.pexels.com/photos/123/large2x.jpg',
          large: 'https://images.pexels.com/photos/123/large.jpg',
          medium: 'https://images.pexels.com/photos/123/medium.jpg',
          small: 'https://images.pexels.com/photos/123/small.jpg',
          portrait: 'https://images.pexels.com/photos/123/portrait.jpg',
          landscape: 'https://images.pexels.com/photos/123/landscape.jpg',
          tiny: 'https://images.pexels.com/photos/123/tiny.jpg',
        },
        liked: false,
        alt: 'Triathlon athlete swimming',
      },
    ],
    next_page: 'https://api.pexels.com/v1/search?page=2&per_page=5&query=triathlon',
  },
};

/**
 * Mock Ollama responses
 */
export const mockOllamaResponses = {
  chat: {
    message: {
      role: 'assistant',
      content: 'Great question! For your first triathlon, focus on building a solid base in all three disciplines. Start with comfortable distances and gradually increase.',
    },
  },
  listModels: {
    models: [
      {
        name: 'llama3.1:8b',
        modified_at: new Date().toISOString(),
        size: 4000000000,
      },
    ],
  },
};
