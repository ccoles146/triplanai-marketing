import type { RankingWeights, SocialPlatform } from './types';

/**
 * Subreddits to scan for triathlon content
 */
export const SUBREDDITS = [
  'triathlon',
  'Ironman',
  'triathlontraining',
  'Swimming',
  'cycling',
  'running',
] as const;

/**
 * Triathlon-related keywords for content matching
 */
export const TRIATHLON_KEYWORDS = [
  // Race distances & formats
  'triathlon',
  'ironman',
  '70.3',
  'half ironman',
  'olympic distance',
  'sprint triathlon',
  'super sprint',
  'duathlon',
  'aquathlon',

  // Disciplines
  'swim bike run',
  'open water swimming',
  'brick workout',
  'brick session',
  'transition',
  'T1',
  'T2',

  // Training concepts
  'triathlon training',
  'tri training',
  'endurance training',
  'FTP',
  'threshold',
  'zone 2',
  'base training',
  'build phase',
  'taper',
  'race week',

  // Gear
  'tri suit',
  'trisuit',
  'wetsuit',
  'aero helmet',
  'TT bike',
  'tri bike',
  'triathlon bike',
  'clip-on aero bars',
  'race belt',
  'elastic laces',

  // Major events
  'kona',
  'IM world championship',
  'challenge roth',
  'nice triathlon',
  'challenge family',

  // Common questions/topics
  'first triathlon',
  'beginner triathlon',
  'triathlon plan',
  'training plan',
  'race nutrition',
  'race day',
] as const;

/**
 * Twitter/X hashtags to search
 */
export const TWITTER_HASHTAGS = [
  '#triathlon',
  '#ironman',
  '#tri',
  '#swimbikerun',
  '#triathlontraining',
  '#703',
  '#triathlonlife',
  '#triathlete',
  '#endurance',
] as const;

/**
 * Instagram hashtags to search (limited by API - max 30 unique per 7 days)
 */
export const INSTAGRAM_HASHTAGS = [
  'triathlon',
  'ironman',
  'swimbikerun',
  'triathlontraining',
  'triathlete',
] as const;

/**
 * Patterns to exclude (spam, sales, etc.)
 */
export const EXCLUDE_PATTERNS = [
  /buy\s+now/i,
  /discount\s+code/i,
  /dm\s+for\s+price/i,
  /limited\s+(time\s+)?offer/i,
  /link\s+in\s+bio/i,
  /free\s+shipping/i,
  /use\s+code/i,
  /\$\d+\s*off/i,
  /affiliate/i,
  /sponsored/i,
] as const;

/**
 * Patterns indicating a question or request for help
 * Used to prioritize posts worth replying to
 */
export const QUESTION_PATTERNS = [
  /\?$/,                                    // Ends with question mark
  /how\s+(do|can|should|would)/i,           // How to questions
  /what\s+(is|are|should|would|do)/i,       // What questions
  /any\s+(tips|advice|suggestions|help)/i,  // Seeking advice
  /looking\s+for\s+(help|advice|tips)/i,    // Looking for help
  /recommend/i,                             // Recommendations
  /beginner/i,                              // Beginner questions
  /first\s+(triathlon|race|ironman|70\.3)/i,// First-timer questions
  /struggling\s+with/i,                     // Struggling with something
  /need\s+help/i,                           // Direct help request
  /thoughts\s+on/i,                         // Opinion request
  /anyone\s+(else|here|know)/i,             // Community question
] as const;

/**
 * Platform-specific ranking weights
 * X/Twitter prioritizes recency (real-time conversation)
 * Reddit/Instagram are more forgiving of older content
 */
export const RANKING_WEIGHTS: Record<SocialPlatform, RankingWeights> = {
  twitter: {
    keyword: 0.25,
    engagement: 0.25,
    recency: 0.40,    // Critical for X - stale replies are worthless
    question: 0.10,
  },
  reddit: {
    keyword: 0.35,
    engagement: 0.30,
    recency: 0.20,    // Less time-sensitive
    question: 0.15,
  },
  instagram: {
    keyword: 0.35,
    engagement: 0.30,
    recency: 0.20,    // Less time-sensitive
    question: 0.15,
  },
};

/**
 * Rate limits per platform (conservative to avoid hitting API limits)
 */
export const PLATFORM_RATE_LIMITS: Record<SocialPlatform, { requestsPerWindow: number; windowSeconds: number }> = {
  reddit: {
    requestsPerWindow: 60,      // Reddit allows 60/min
    windowSeconds: 60,
  },
  twitter: {
    requestsPerWindow: 15,      // Twitter Basic: 15 requests per 15 min
    windowSeconds: 900,
  },
  instagram: {
    requestsPerWindow: 200,     // Instagram: 200/hour
    windowSeconds: 3600,
  },
};

/**
 * Pexels search queries for triathlon-related images
 */
export const PEXELS_SEARCH_QUERIES = [
  'triathlon',
  'swimming pool athlete',
  'cycling race',
  'marathon runner',
  'endurance training',
  'fitness athlete',
  'open water swimming',
  'road cycling',
] as const;
