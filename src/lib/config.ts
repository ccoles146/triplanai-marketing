/**
 * Default configuration for the marketing automation system
 * These values can be overridden via environment variables
 */

import type { SocialPlatform } from './types';

export interface PlatformConfig {
  scanCron: string;
  candidatesPerScan: number;
  dailyPostLimit: number;
}

export interface AppConfig {
  reddit: PlatformConfig & {
    subreddits: string[];
    rankingLimit: number;
  };
  twitter: PlatformConfig;
  instagram: PlatformConfig;
}

/**
 * Default configuration values
 * Can be overridden via environment variables in .env
 */
export const DEFAULT_CONFIG: AppConfig = {
  reddit: {
    // Scan every 6 hours (at 0, 6, 12, 18:00)
    scanCron: '0 */6 * * *',

    // Select top 2 candidates per scan
    candidatesPerScan: 2,

    // Maximum 3 posts per day
    dailyPostLimit: 3,

    // Subreddits to scan (removed swimming, running per user request)
    subreddits: [
      'triathlon',
      'Ironman',
      'triathlontraining',
      'cycling',
    ],

    // Number of posts to rank initially before filtering
    rankingLimit: 20,
  },

  twitter: {
    // Scan once daily at 8 AM (optimal engagement time)
    scanCron: '0 8 * * *',

    // Select top 2 candidates per scan
    candidatesPerScan: 2,

    // Maximum 3 posts per day
    dailyPostLimit: 3,
  },

  instagram: {
    // Scan once daily at 10 AM
    scanCron: '0 10 * * *',

    // Select top 2 candidates per scan
    candidatesPerScan: 2,

    // Maximum 3 posts per day
    dailyPostLimit: 3,
  },
};

/**
 * Load configuration with environment variable overrides
 */
export function getConfig(): AppConfig {
  return {
    reddit: {
      scanCron: process.env.REDDIT_SCAN_CRON || DEFAULT_CONFIG.reddit.scanCron,
      candidatesPerScan: parseInt(process.env.REDDIT_CANDIDATES_PER_SCAN || String(DEFAULT_CONFIG.reddit.candidatesPerScan), 10),
      dailyPostLimit: parseInt(process.env.REDDIT_DAILY_POST_LIMIT || String(DEFAULT_CONFIG.reddit.dailyPostLimit), 10),
      subreddits: process.env.REDDIT_SUBREDDITS
        ? process.env.REDDIT_SUBREDDITS.split(',').map(s => s.trim())
        : DEFAULT_CONFIG.reddit.subreddits,
      rankingLimit: parseInt(process.env.REDDIT_RANKING_LIMIT || String(DEFAULT_CONFIG.reddit.rankingLimit), 10),
    },
    twitter: {
      scanCron: process.env.TWITTER_SCAN_CRON || DEFAULT_CONFIG.twitter.scanCron,
      candidatesPerScan: parseInt(process.env.TWITTER_CANDIDATES_PER_SCAN || String(DEFAULT_CONFIG.twitter.candidatesPerScan), 10),
      dailyPostLimit: parseInt(process.env.TWITTER_DAILY_POST_LIMIT || String(DEFAULT_CONFIG.twitter.dailyPostLimit), 10),
    },
    instagram: {
      scanCron: process.env.INSTAGRAM_SCAN_CRON || DEFAULT_CONFIG.instagram.scanCron,
      candidatesPerScan: parseInt(process.env.INSTAGRAM_CANDIDATES_PER_SCAN || String(DEFAULT_CONFIG.instagram.candidatesPerScan), 10),
      dailyPostLimit: parseInt(process.env.INSTAGRAM_DAILY_POST_LIMIT || String(DEFAULT_CONFIG.instagram.dailyPostLimit), 10),
    },
  };
}

// Singleton instance
let configInstance: AppConfig | null = null;

/**
 * Get the application configuration (loads once)
 */
export function getAppConfig(): AppConfig {
  if (!configInstance) {
    configInstance = getConfig();
  }
  return configInstance;
}
