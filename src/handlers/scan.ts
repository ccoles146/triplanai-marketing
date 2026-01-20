import { getEnv } from '../lib/env';
import type { SocialPost, ScanResult, SocialPlatform, GeneratedReply } from '../lib/types';
import { scanReddit } from '../scanners/reddit';
import { scanTwitter } from '../scanners/twitter';
import { rankPosts, filterForReply } from '../services/ranking';
import { generateReplies } from '../services/reply-generator';
import {
  sendApprovalRequest,
  sendInstagramOpportunity,
  sendNotification,
} from '../services/telegram';
import {
  canMakeRequest,
  recordRequest,
  isProcessed,
  markProcessed,
  canPostToday,
  storePendingReply,
} from '../services/rate-limiter';

/**
 * Main scan handler - orchestrates scanning all platforms
 */
export async function runScan(): Promise<ScanResult[]> {
  const env = getEnv();
  console.log('[scan] Starting scheduled scan');

  const results: ScanResult[] = [];
  const allCandidates: SocialPost[] = [];

  // Scan each platform and collect candidates
  const platforms: SocialPlatform[] = ['reddit', 'twitter'];

  for (const platform of platforms) {
    const { result, candidates } = await scanPlatform(platform);
    results.push(result);
    allCandidates.push(...candidates);
  }

  // Generate replies for top candidates (max 3 total per scan)
  if (allCandidates.length > 0) {
    const topCandidates = allCandidates
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 3);

    console.log(`[scan] Generating replies for ${topCandidates.length} candidates`);

    const replies = await generateReplies(topCandidates);

    // Send to Telegram for approval
    for (const reply of replies) {
      await sendToTelegram(reply);

      // Update results
      const platformResult = results.find((r) => r.platform === reply.platform);
      if (platformResult) {
        platformResult.repliesGenerated++;
        platformResult.approvalsSent++;
      }
    }
  }

  // Log summary
  const totalScanned = results.reduce((sum, r) => sum + r.postsScanned, 0);
  const totalNew = results.reduce((sum, r) => sum + r.postsNew, 0);
  const totalReplies = results.reduce((sum, r) => sum + r.repliesGenerated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(
    `[scan] Complete: ${totalScanned} scanned, ${totalNew} new, ${totalReplies} replies, ${totalErrors} errors`
  );

  // Send summary to Telegram if any work was done
  if (totalReplies > 0) {
    await sendNotification(
      `🔄 Scan complete: ${totalReplies} new opportunities sent for review`
    );
  }

  return results;
}

/**
 * Scan a single platform and return candidates
 */
async function scanPlatform(
  platform: SocialPlatform
): Promise<{ result: ScanResult; candidates: SocialPost[] }> {
  const env = getEnv();
  const result: ScanResult = {
    platform,
    postsScanned: 0,
    postsNew: 0,
    postsRanked: 0,
    repliesGenerated: 0,
    approvalsSent: 0,
    errors: [],
  };

  const candidates: SocialPost[] = [];

  try {
    // Check rate limit
    if (!canMakeRequest(platform)) {
      console.log(`[scan] Rate limited for ${platform}, skipping`);
      return { result, candidates };
    }

    // Check daily post limit (max 3 per day per platform)
    if (!canPostToday(platform, 3)) {
      console.log(`[scan] Daily limit reached for ${platform}, skipping`);
      return { result, candidates };
    }

    // Scan platform
    let posts: SocialPost[] = [];

    switch (platform) {
      case 'reddit':
        posts = await scanReddit(env);
        break;
      case 'twitter':
        posts = await scanTwitter(env);
        break;
      case 'instagram':
        // Instagram scanner not yet implemented
        console.log('[scan] Instagram scanning not yet implemented');
        return { result, candidates };
    }

    recordRequest(platform);
    result.postsScanned = posts.length;

    console.log(`[scan] ${platform}: Scanned ${posts.length} posts`);

    // Filter out already processed posts
    const newPosts: SocialPost[] = [];
    for (const post of posts) {
      if (!isProcessed(post.id)) {
        newPosts.push(post);
      }
    }
    result.postsNew = newPosts.length;

    if (newPosts.length === 0) {
      console.log(`[scan] ${platform}: No new posts to process`);
      return { result, candidates };
    }

    // Rank posts
    const rankedPosts = rankPosts(newPosts, 20);
    result.postsRanked = rankedPosts.length;

    // Filter for posts worth replying to
    const postsForReply = filterForReply(rankedPosts);

    console.log(
      `[scan] ${platform}: ${postsForReply.length}/${rankedPosts.length} posts qualified for reply`
    );

    // Mark all scanned posts as processed to avoid re-checking
    for (const post of rankedPosts) {
      markProcessed(post.id);
    }

    // Return top candidates
    candidates.push(...postsForReply.slice(0, 3));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error(`[scan] ${platform} error:`, error);
  }

  return { result, candidates };
}

/**
 * Send a generated reply to Telegram for approval
 */
async function sendToTelegram(reply: GeneratedReply): Promise<void> {
  try {
    // Store pending reply
    storePendingReply({
      postId: reply.postId,
      platform: reply.platform,
      replyText: reply.replyText,
      originalPostUrl: reply.originalPost.url,
      createdAt: Date.now(),
    });

    // Send to Telegram
    let result;
    if (reply.platform === 'instagram') {
      result = await sendInstagramOpportunity(reply);
    } else {
      result = await sendApprovalRequest(reply);
    }

    if (result.success) {
      console.log(`[scan] Sent ${reply.platform} opportunity to Telegram: ${result.messageId}`);
    } else {
      console.error(`[scan] Failed to send to Telegram: ${result.error}`);
    }
  } catch (error) {
    console.error(`[scan] Error sending to Telegram:`, error);
  }
}

/**
 * Get top candidates for reply across all platforms (for testing)
 */
export async function getTopCandidates(limit: number = 5): Promise<SocialPost[]> {
  const env = getEnv();
  const allPosts: SocialPost[] = [];

  // Scan all platforms
  for (const platform of ['reddit', 'twitter'] as const) {
    try {
      if (!canMakeRequest(platform)) {
        continue;
      }

      let posts: SocialPost[] = [];
      switch (platform) {
        case 'reddit':
          posts = await scanReddit(env);
          break;
        case 'twitter':
          posts = await scanTwitter(env);
          break;
      }

      recordRequest(platform);

      // Filter out processed posts
      for (const post of posts) {
        if (!isProcessed(post.id)) {
          allPosts.push(post);
        }
      }
    } catch (error) {
      console.error(`[scan] Error scanning ${platform}:`, error);
    }
  }

  // Rank all posts together
  const ranked = rankPosts(allPosts, limit * 2);

  // Filter for reply candidates
  const candidates = filterForReply(ranked);

  return candidates.slice(0, limit);
}
