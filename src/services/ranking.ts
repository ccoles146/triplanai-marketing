import type { SocialPost, SocialPlatform } from '../lib/types';
import {
  TRIATHLON_KEYWORDS,
  QUESTION_PATTERNS,
  RANKING_WEIGHTS,
} from '../lib/keywords';

/**
 * Calculate keyword relevance score (0-100)
 * Based on how many triathlon keywords match in the content
 */
function calculateKeywordScore(post: SocialPost): number {
  const text = ((post.title || '') + ' ' + post.content).toLowerCase();

  let matches = 0;
  for (const keyword of TRIATHLON_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      matches++;
    }
  }

  // Normalize: cap at 5 matches for 100%
  const baseScore = (Math.min(matches, 5) / 5) * 100;

  // Bonus multiplier for multiple keyword matches
  const bonusMultiplier = 1 + Math.min(matches * 0.05, 0.25);

  return Math.min(100, baseScore * bonusMultiplier);
}

/**
 * Calculate engagement score normalized (0-100)
 * Uses logarithmic scaling to handle viral posts
 */
function calculateEngagementScore(
  post: SocialPost,
  maxEngagement: number
): number {
  if (maxEngagement === 0) return 50; // Default middle score

  // Logarithmic scaling to handle viral posts gracefully
  const logScore = Math.log10(post.engagementScore + 1);
  const logMax = Math.log10(maxEngagement + 1);

  return (logScore / logMax) * 100;
}

/**
 * Calculate recency score (0-100) with platform-specific decay
 * Twitter: Aggressive decay (2-hour half-life)
 * Reddit/Instagram: Gentle decay (12-hour half-life)
 */
function calculateRecencyScore(post: SocialPost): number {
  const ageMs = Date.now() - post.createdAt.getTime();

  if (post.platform === 'twitter') {
    // Twitter: aggressive decay, 2-hour half-life
    const ageMinutes = ageMs / (1000 * 60);

    if (ageMinutes < 30) return 100;
    if (ageMinutes > 240) return 10; // 4 hours = almost worthless

    return Math.max(10, 100 * Math.exp(-ageMinutes / 120));
  } else {
    // Reddit/Instagram: gentle decay, 12-hour half-life
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours < 1) return 100;
    if (ageHours > 48) return 10;

    return Math.max(10, 100 * Math.exp(-ageHours / 12));
  }
}

/**
 * Calculate question detection score (0-100)
 * Higher score if post appears to be asking a question or seeking help
 */
function calculateQuestionScore(post: SocialPost): number {
  const text = (post.title || '') + ' ' + post.content;

  let matches = 0;
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(text)) {
      matches++;
    }
  }

  // More matches = higher confidence it's a question
  // Cap at 3 matches for full score
  return Math.min(100, (Math.min(matches, 3) / 3) * 100);
}

/**
 * Calculate overall relevance score for a post
 */
function calculateRelevanceScore(
  post: SocialPost,
  maxEngagement: number
): number {
  const weights = RANKING_WEIGHTS[post.platform];

  const keywordScore = calculateKeywordScore(post);
  const engagementScore = calculateEngagementScore(post, maxEngagement);
  const recencyScore = calculateRecencyScore(post);
  const questionScore = calculateQuestionScore(post);

  const totalScore =
    keywordScore * weights.keyword +
    engagementScore * weights.engagement +
    recencyScore * weights.recency +
    questionScore * weights.question;

  return Math.round(totalScore);
}

/**
 * Rank posts by relevance and return top N
 */
export function rankPosts(posts: SocialPost[], limit: number = 10): SocialPost[] {
  if (posts.length === 0) return [];

  // Find max engagement for normalization
  const maxEngagement = Math.max(...posts.map((p) => p.engagementScore));

  // Calculate relevance scores
  for (const post of posts) {
    post.relevanceScore = calculateRelevanceScore(post, maxEngagement);
  }

  // Sort by relevance (descending) and return top N
  return posts.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
}

/**
 * Filter posts that are good candidates for replying to
 * - Minimum relevance threshold
 * - Appears to be a question or seeking help
 */
export function filterForReply(
  posts: SocialPost[],
  minRelevance: number = 40
): SocialPost[] {
  return posts.filter((post) => {
    // Must meet minimum relevance
    if (post.relevanceScore < minRelevance) {
      return false;
    }

    // Check if it's a question or seeking help
    const text = (post.title || '') + ' ' + post.content;
    const isQuestion = QUESTION_PATTERNS.some((pattern) => pattern.test(text));

    return isQuestion;
  });
}

/**
 * Group posts by platform for processing
 */
export function groupByPlatform(
  posts: SocialPost[]
): Record<SocialPlatform, SocialPost[]> {
  const grouped: Record<SocialPlatform, SocialPost[]> = {
    reddit: [],
    twitter: [],
    instagram: [],
  };

  for (const post of posts) {
    grouped[post.platform].push(post);
  }

  return grouped;
}

/**
 * Get a human-readable summary of ranking factors
 */
export function getRankingBreakdown(
  post: SocialPost,
  maxEngagement: number
): {
  keyword: number;
  engagement: number;
  recency: number;
  question: number;
  total: number;
} {
  return {
    keyword: Math.round(calculateKeywordScore(post)),
    engagement: Math.round(calculateEngagementScore(post, maxEngagement)),
    recency: Math.round(calculateRecencyScore(post)),
    question: Math.round(calculateQuestionScore(post)),
    total: post.relevanceScore,
  };
}
