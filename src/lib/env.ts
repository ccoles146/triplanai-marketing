/**
 * Environment configuration for the self-hosted marketing automation
 */

export interface Env {
  // Server config
  PORT: number;

  // Ollama config
  OLLAMA_HOST: string;
  OLLAMA_MODEL: string;

  // Reddit OAuth credentials
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  REDDIT_USERNAME: string;
  REDDIT_PASSWORD: string;
  REDDIT_USER_AGENT: string;

  // X/Twitter API credentials
  TWITTER_BEARER_TOKEN: string;
  TWITTER_API_KEY: string;
  TWITTER_API_SECRET: string;
  TWITTER_ACCESS_TOKEN: string;
  TWITTER_ACCESS_SECRET: string;

  // Instagram Graph API (for hashtag search only)
  INSTAGRAM_ACCESS_TOKEN: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID: string;

  // Facebook Page (for cross-posting)
  FACEBOOK_PAGE_ID: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  // Webhook configuration
  WEBHOOK_URL: string;

  // Media services
  PEXELS_API_KEY: string;

  // Optional: Video generation
  CREATOMATE_API_KEY?: string;

  // Environment info
  ENVIRONMENT?: 'development' | 'preview' | 'production';
}

/**
 * Load environment from process.env
 */
export function loadEnv(): Env {
  return {
    PORT: parseInt(process.env.PORT || '3000', 10),
    OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.1:8b',

    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || '',
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET || '',
    REDDIT_USERNAME: process.env.REDDIT_USERNAME || '',
    REDDIT_PASSWORD: process.env.REDDIT_PASSWORD || '',
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT || '',

    TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',
    TWITTER_API_KEY: process.env.TWITTER_API_KEY || '',
    TWITTER_API_SECRET: process.env.TWITTER_API_SECRET || '',
    TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN || '',
    TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET || '',

    INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    INSTAGRAM_BUSINESS_ACCOUNT_ID: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',

    FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID || '',
    FACEBOOK_PAGE_ACCESS_TOKEN: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',

    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',

    WEBHOOK_URL: process.env.WEBHOOK_URL || '',

    PEXELS_API_KEY: process.env.PEXELS_API_KEY || '',
    CREATOMATE_API_KEY: process.env.CREATOMATE_API_KEY,

    ENVIRONMENT: (process.env.ENVIRONMENT as Env['ENVIRONMENT']) || 'development',
  };
}

/**
 * Check if required environment variables are set
 * Platform credentials are optional - the app will skip platforms without credentials
 */
export function validateEnv(env: Env): { valid: boolean; missing: string[] } {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ];

  const missing = required.filter(
    (key) => !env[key as keyof Env]
  );

  return {
    valid: missing.length === 0,
    missing,
  };
}

// Singleton instance
let envInstance: Env | null = null;

/**
 * Get the environment configuration (loads once)
 */
export function getEnv(): Env {
  if (!envInstance) {
    envInstance = loadEnv();
  }
  return envInstance;
}
