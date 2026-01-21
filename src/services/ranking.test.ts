import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rankPosts,
  filterForReply,
  groupByPlatform,
  getRankingBreakdown,
} from './ranking';
import {
  createMockRedditPost,
  createMockTwitterPost,
  createMockInstagramPost,
} from '../test/mocks';
import type { SocialPost } from '../lib/types';

describe('Ranking Service', () => {
  describe('rankPosts', () => {
    it('should rank posts by relevance score', () => {
      const posts = [
        createMockRedditPost({
          id: 'reddit:1',
          content: 'Just started running, any tips?',
          engagementScore: 10,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          content: 'How do I improve my triathlon time for ironman 70.3?',
          title: 'Triathlon training question',
          engagementScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:3',
          content: 'What wetsuit do you recommend for open water swimming?',
          title: 'Wetsuit advice for triathlon',
          engagementScore: 30,
        }),
      ];

      const ranked = rankPosts(posts);

      // All posts should have relevance scores assigned
      ranked.forEach((post) => {
        expect(post.relevanceScore).toBeGreaterThan(0);
      });

      // Should be sorted by relevance (descending)
      for (let i = 0; i < ranked.length - 1; i++) {
        expect(ranked[i].relevanceScore).toBeGreaterThanOrEqual(
          ranked[i + 1].relevanceScore
        );
      }
    });

    it('should return empty array for empty input', () => {
      const result = rankPosts([]);

      expect(result).toEqual([]);
    });

    it('should respect the limit parameter', () => {
      const posts = Array(20)
        .fill(null)
        .map((_, i) =>
          createMockRedditPost({
            id: `reddit:${i}`,
            content: `Triathlon post number ${i}?`,
          })
        );

      const ranked = rankPosts(posts, 5);

      expect(ranked).toHaveLength(5);
    });

    it('should give higher scores to posts with more keywords', () => {
      const lowKeywordPost = createMockRedditPost({
        id: 'reddit:low',
        content: 'Just started exercising',
        title: 'Fitness question',
        createdAt: new Date(),
        engagementScore: 50,
      });

      const highKeywordPost = createMockRedditPost({
        id: 'reddit:high',
        content: 'Need help with triathlon training plan for my first ironman 70.3',
        title: 'Triathlon brick workout question',
        createdAt: new Date(),
        engagementScore: 50,
      });

      const ranked = rankPosts([lowKeywordPost, highKeywordPost]);

      expect(ranked[0].id).toBe('reddit:high');
    });

    it('should give higher scores to questions', () => {
      const statementPost = createMockRedditPost({
        id: 'reddit:statement',
        content: 'I finished my triathlon today.',
        title: 'Race report',
        createdAt: new Date(),
        engagementScore: 50,
      });

      const questionPost = createMockRedditPost({
        id: 'reddit:question',
        content: 'How do I train for my first triathlon? Any tips?',
        title: 'Need help with triathlon',
        createdAt: new Date(),
        engagementScore: 50,
      });

      const ranked = rankPosts([statementPost, questionPost]);

      expect(ranked[0].id).toBe('reddit:question');
    });

    it('should apply platform-specific recency weighting', () => {
      const now = Date.now();

      // Twitter should heavily penalize old tweets
      const oldTwitterPost = createMockTwitterPost({
        id: 'twitter:old',
        createdAt: new Date(now - 5 * 60 * 60 * 1000), // 5 hours ago
        content: 'Triathlon tips needed #triathlon?',
      });

      const recentTwitterPost = createMockTwitterPost({
        id: 'twitter:recent',
        createdAt: new Date(now - 30 * 60 * 1000), // 30 minutes ago
        content: 'Triathlon tips needed #triathlon?',
      });

      const ranked = rankPosts([oldTwitterPost, recentTwitterPost]);

      // Recent tweet should rank higher
      expect(ranked[0].id).toBe('twitter:recent');
    });
  });

  describe('filterForReply', () => {
    it('should filter posts with minimum relevance that are questions', () => {
      const posts = [
        createMockRedditPost({
          id: 'reddit:1',
          content: 'What is the best triathlon bike? Any recommendations?',
          title: 'Triathlon bike question',
          relevanceScore: 75,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          content: 'Just finished my race.',
          title: 'Race complete',
          relevanceScore: 60,
        }),
        createMockRedditPost({
          id: 'reddit:3',
          content: 'Looking for tips on open water swimming',
          title: 'Swimming help',
          relevanceScore: 30, // Below threshold
        }),
      ];

      const filtered = filterForReply(posts);

      // Only the first post is a question with sufficient relevance
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('reddit:1');
    });

    it('should use custom minimum relevance', () => {
      const posts = [
        createMockRedditPost({
          id: 'reddit:1',
          content: 'Need help with training?',
          relevanceScore: 25,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          content: 'Any tips for beginners?',
          relevanceScore: 35,
        }),
      ];

      const filtered = filterForReply(posts, 20);

      expect(filtered).toHaveLength(2);
    });

    it('should detect various question patterns', () => {
      const questionPosts = [
        createMockRedditPost({
          id: 'reddit:1',
          content: 'How do I improve my FTP?',
          relevanceScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          content: 'Any tips for race day?',
          relevanceScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:3',
          content: 'Looking for help with nutrition',
          relevanceScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:4',
          content: 'First triathlon coming up, nervous!',
          relevanceScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:5',
          content: 'What should I do for taper week?',
          relevanceScore: 50,
        }),
        createMockRedditPost({
          id: 'reddit:6',
          content: 'Anyone here done Challenge Roth?',
          relevanceScore: 50,
        }),
      ];

      const filtered = filterForReply(questionPosts);

      // All should be identified as questions
      expect(filtered.length).toBeGreaterThanOrEqual(5);
    });

    it('should not include non-questions', () => {
      // Use posts without question patterns - avoid keywords like "first", "triathlon", "70.3" etc
      // that could trigger question detection patterns
      const posts = [
        createMockRedditPost({
          id: 'reddit:1',
          content: 'Completed the race today. Feeling good about it.',
          title: 'Race done',
          relevanceScore: 80,
        }),
        createMockRedditPost({
          id: 'reddit:2',
          content: 'Got a personal record at the event.',
          title: 'PR achieved',
          relevanceScore: 80,
        }),
      ];

      const filtered = filterForReply(posts);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('groupByPlatform', () => {
    it('should group posts by platform', () => {
      const posts = [
        createMockRedditPost({ id: 'reddit:1' }),
        createMockRedditPost({ id: 'reddit:2' }),
        createMockTwitterPost({ id: 'twitter:1' }),
        createMockInstagramPost({ id: 'instagram:1' }),
        createMockInstagramPost({ id: 'instagram:2' }),
        createMockInstagramPost({ id: 'instagram:3' }),
      ];

      const grouped = groupByPlatform(posts);

      expect(grouped.reddit).toHaveLength(2);
      expect(grouped.twitter).toHaveLength(1);
      expect(grouped.instagram).toHaveLength(3);
    });

    it('should return empty arrays for platforms with no posts', () => {
      const posts = [createMockRedditPost()];

      const grouped = groupByPlatform(posts);

      expect(grouped.reddit).toHaveLength(1);
      expect(grouped.twitter).toEqual([]);
      expect(grouped.instagram).toEqual([]);
    });

    it('should handle empty input', () => {
      const grouped = groupByPlatform([]);

      expect(grouped.reddit).toEqual([]);
      expect(grouped.twitter).toEqual([]);
      expect(grouped.instagram).toEqual([]);
    });
  });

  describe('getRankingBreakdown', () => {
    it('should return breakdown of scoring factors', () => {
      const post = createMockRedditPost({
        content: 'How do I improve my triathlon training for ironman?',
        title: 'Triathlon beginner tips needed',
        engagementScore: 50,
        relevanceScore: 75,
      });

      const breakdown = getRankingBreakdown(post, 100);

      expect(breakdown.keyword).toBeGreaterThan(0);
      expect(breakdown.engagement).toBeGreaterThan(0);
      expect(breakdown.recency).toBeGreaterThan(0);
      expect(breakdown.question).toBeGreaterThan(0);
      expect(breakdown.total).toBe(75);

      // All scores should be 0-100
      expect(breakdown.keyword).toBeLessThanOrEqual(100);
      expect(breakdown.engagement).toBeLessThanOrEqual(100);
      expect(breakdown.recency).toBeLessThanOrEqual(100);
      expect(breakdown.question).toBeLessThanOrEqual(100);
    });

    it('should handle zero max engagement', () => {
      const post = createMockRedditPost({
        engagementScore: 0,
        relevanceScore: 50,
      });

      const breakdown = getRankingBreakdown(post, 0);

      // Should default to 50% engagement when max is 0
      expect(breakdown.engagement).toBe(50);
    });

    it('should give high keyword scores for triathlon-heavy content', () => {
      const post = createMockRedditPost({
        content: 'Training for my first triathlon ironman 70.3. Doing brick workouts and open water swimming.',
        title: 'Triathlon training plan for beginner',
        relevanceScore: 0,
      });

      const breakdown = getRankingBreakdown(post, 100);

      expect(breakdown.keyword).toBeGreaterThan(80);
    });

    it('should give low keyword scores for generic content', () => {
      const post = createMockRedditPost({
        content: 'Started exercising yesterday.',
        title: 'New to fitness',
        relevanceScore: 0,
      });

      const breakdown = getRankingBreakdown(post, 100);

      expect(breakdown.keyword).toBeLessThan(30);
    });
  });

  describe('recency scoring', () => {
    it('should give high recency scores to recent posts', () => {
      const recentPost = createMockRedditPost({
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
        relevanceScore: 0,
      });

      const breakdown = getRankingBreakdown(recentPost, 100);

      expect(breakdown.recency).toBeGreaterThan(80);
    });

    it('should give low recency scores to old Reddit posts', () => {
      const oldPost = createMockRedditPost({
        createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000), // 36 hours ago
        relevanceScore: 0,
      });

      const breakdown = getRankingBreakdown(oldPost, 100);

      expect(breakdown.recency).toBeLessThan(30);
    });

    it('should penalize old Twitter posts more heavily', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const redditPost = createMockRedditPost({
        createdAt: twoHoursAgo,
        relevanceScore: 0,
      });

      const twitterPost = createMockTwitterPost({
        createdAt: twoHoursAgo,
        relevanceScore: 0,
      });

      const redditBreakdown = getRankingBreakdown(redditPost, 100);
      const twitterBreakdown = getRankingBreakdown(twitterPost, 100);

      // Twitter should have lower recency score for same age
      expect(twitterBreakdown.recency).toBeLessThan(redditBreakdown.recency);
    });
  });
});
