import { getEnv } from '../lib/env';
import type { SocialPlatform } from '../lib/types';
import {
  decodeCallbackData,
  answerCallbackQuery,
  updateMessageStatus,
} from '../services/telegram';
import {
  getPendingReply,
  deletePendingReply,
  incrementDailyPostCount,
} from '../services/rate-limiter';
import { postRedditReply, postToTriplanaiSubreddit } from '../scanners/reddit';
import { postTwitterReply } from '../scanners/twitter';

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
      first_name?: string;
    };
    message?: {
      message_id: number;
      chat: { id: number };
    };
    data?: string;
  };
}

/**
 * Handle incoming Telegram webhook (for Express)
 */
export async function handleTelegramWebhook(body: TelegramUpdate): Promise<{ ok: boolean }> {
  try {
    // Only handle callback queries (button presses)
    if (!body.callback_query) {
      return { ok: true };
    }

    const { id, from, message, data } = body.callback_query;

    // Acknowledge the button press immediately
    await answerCallbackQuery(id, 'Processing...');

    if (!data || !message) {
      return { ok: true };
    }

    // Decode callback data
    const callbackData = decodeCallbackData(data);
    if (!callbackData) {
      console.error('[webhook] Invalid callback data:', data);
      return { ok: true };
    }

    const { action, postId, platform } = callbackData;
    const messageId = message.message_id.toString();
    const username = from.username || from.first_name || 'unknown';

    console.log(`[webhook] Action: ${action}, Post: ${postId}, Platform: ${platform}, User: ${username}`);

    // Get pending reply from DB
    const pending = getPendingReply(postId);

    if (!pending) {
      await updateMessageStatus(messageId, 'failed', 'Reply expired or already processed');
      return { ok: true };
    }

    // Handle different actions
    switch (action) {
      case 'approve':
        await handleApprove(pending, messageId, username, false);
        break;

      case 'approve_crosspost':
        await handleApprove(pending, messageId, username, true);
        break;

      case 'decline':
        await handleDecline(postId, messageId, username);
        break;

      case 'mark_done':
        await handleMarkDone(postId, messageId, username);
        break;
    }

    return { ok: true };
  } catch (error) {
    console.error('[webhook] Error:', error);
    // Always return ok to Telegram to avoid retries
    return { ok: true };
  }
}

/**
 * Handle approve action - post the reply
 */
async function handleApprove(
  pending: { postId: string; platform: SocialPlatform; replyText: string; originalPostUrl: string },
  messageId: string,
  username: string,
  crossPost: boolean
): Promise<void> {
  const env = getEnv();
  const { postId, platform, replyText, originalPostUrl } = pending;
  const externalId = postId.replace(`${platform}:`, '');

  let result: { success: boolean; error?: string; url?: string };

  // Post to the original platform
  switch (platform) {
    case 'reddit':
      result = await postRedditReply(env, externalId, replyText, originalPostUrl);
      break;

    case 'twitter':
      result = await postTwitterReply(env, externalId, replyText);
      break;

    case 'instagram':
      // Instagram doesn't support auto-posting, this shouldn't happen
      result = { success: false, error: 'Instagram requires manual posting' };
      break;

    default:
      result = { success: false, error: `Unknown platform: ${platform}` };
  }

  if (!result.success) {
    // Check if this is a manual posting scenario (URL provided)
    if (result.url) {
      await updateMessageStatus(
        messageId,
        'manual',
        `Manual posting required\n\n📋 Copy this reply:\n"${replyText}"\n\n🔗 Open post: ${result.url}\n\nMark as done when posted!`,
        { action: 'approve', postId, platform }
      );
      // Don't delete pending reply - user might need to reference it
      return;
    }
    await updateMessageStatus(messageId, 'failed', result.error);
    return;
  }

  // Track daily post count
  incrementDailyPostCount(platform);

  // Handle cross-posting if requested
  if (crossPost) {
    await handleCrossPost(pending, replyText);
  }

  // Update Telegram message
  const details = crossPost ? `Posted by @${username} + cross-posted` : `Posted by @${username}`;
  await updateMessageStatus(messageId, 'posted', details);

  // Clean up
  deletePendingReply(postId);
}

/**
 * Handle cross-posting to r/triplanai and Facebook
 */
async function handleCrossPost(
  pending: { postId: string; platform: SocialPlatform; replyText: string; originalPostUrl: string },
  replyText: string
): Promise<void> {
  const env = getEnv();
  const platformName = pending.platform === 'twitter' ? 'X' : pending.platform;

  // Post to r/triplanai
  try {
    const redditTitle = `Triathlon advice shared on ${platformName}`;
    const redditBody = `Helped someone on ${platformName} with this response:\n\n> Original post: ${pending.originalPostUrl}\n\nOur response:\n\n${replyText}\n\n---\n\nWhat would you add? Share your experience!`;

    const redditResult = await postToTriplanaiSubreddit(env, redditTitle, redditBody);

    if (redditResult.success) {
      console.log(`[crosspost] Posted to r/triplanai: ${redditResult.url}`);
    } else {
      console.error(`[crosspost] r/triplanai failed: ${redditResult.error}`);
    }
  } catch (error) {
    console.error('[crosspost] r/triplanai error:', error);
  }

  // Post to Facebook (if configured)
  if (env.FACEBOOK_PAGE_ACCESS_TOKEN && env.FACEBOOK_PAGE_ID) {
    try {
      const fbPost = `Training tip:\n\n${replyText}\n\nWhat's your experience? 🏊‍♂️🚴‍♂️🏃‍♂️`;

      const fbResponse = await fetch(
        `https://graph.facebook.com/v18.0/${env.FACEBOOK_PAGE_ID}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: fbPost,
            access_token: env.FACEBOOK_PAGE_ACCESS_TOKEN,
          }),
        }
      );

      if (fbResponse.ok) {
        console.log('[crosspost] Posted to Facebook');
      } else {
        const error = await fbResponse.text();
        console.error(`[crosspost] Facebook failed: ${error}`);
      }
    } catch (error) {
      console.error('[crosspost] Facebook error:', error);
    }
  }
}

/**
 * Handle decline action
 */
async function handleDecline(
  postId: string,
  messageId: string,
  username: string
): Promise<void> {
  await updateMessageStatus(messageId, 'declined', `by @${username}`);
  deletePendingReply(postId);
}

/**
 * Handle mark_done action (for Instagram manual posts)
 */
async function handleMarkDone(
  postId: string,
  messageId: string,
  username: string
): Promise<void> {
  // Extract platform from postId
  const platform = postId.split(':')[0] as SocialPlatform;

  incrementDailyPostCount(platform);
  await updateMessageStatus(messageId, 'done', `Marked done by @${username}`);
  deletePendingReply(postId);
}
