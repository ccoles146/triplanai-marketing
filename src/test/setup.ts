/**
 * Test setup file - runs before all tests
 */

import { vi, beforeAll, afterEach, afterAll } from 'vitest';

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.REDDIT_CLIENT_ID = 'test-reddit-client-id';
process.env.REDDIT_CLIENT_SECRET = 'test-reddit-client-secret';
process.env.REDDIT_USERNAME = 'test-reddit-user';
process.env.REDDIT_PASSWORD = 'test-reddit-password';
process.env.REDDIT_USER_AGENT = 'test-user-agent';
process.env.TWITTER_BEARER_TOKEN = 'test-twitter-bearer';
process.env.TWITTER_API_KEY = 'test-twitter-api-key';
process.env.TWITTER_API_SECRET = 'test-twitter-api-secret';
process.env.TWITTER_ACCESS_TOKEN = 'test-twitter-access-token';
process.env.TWITTER_ACCESS_SECRET = 'test-twitter-access-secret';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.PEXELS_API_KEY = 'test-pexels-key';
process.env.FACEBOOK_PAGE_ID = 'test-fb-page-id';
process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'test-fb-token';
process.env.OLLAMA_HOST = 'http://localhost:11434';
process.env.OLLAMA_MODEL = 'llama3.1:8b';

// Use in-memory database for tests
process.env.DB_PATH = ':memory:';

beforeAll(() => {
  // Any global setup
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  // Any global teardown
});
