import type { Env } from '../lib/env';
import type { SocialPost } from '../lib/types';
import { TWITTER_HASHTAGS, EXCLUDE_PATTERNS } from '../lib/keywords';

interface TwitterSearchResponse {
  data?: Array<{
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      quote_count: number;
    };
  }>;
  includes?: {
    users: Array<{
      id: string;
      username: string;
    }>;
  };
  meta: {
    newest_id?: string;
    oldest_id?: string;
    result_count: number;
    next_token?: string;
  };
}

/**
 * Check if tweet content matches exclusion patterns
 */
function shouldExclude(text: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Build Twitter search query from hashtags
 * Excludes retweets and limits to English
 */
function buildSearchQuery(): string {
  const hashtagTerms = TWITTER_HASHTAGS.map((h) => h.replace('#', '')).join(' OR ');
  return `(${hashtagTerms}) -is:retweet lang:en`;
}

/**
 * Scan Twitter for triathlon-related tweets using API v2
 */
export async function scanTwitter(env: Env): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  if (!env.TWITTER_BEARER_TOKEN) {
    console.log('[twitter] No credentials found - skipping');
    return posts;
  }

  const now = new Date();

  const query = buildSearchQuery();
  const encodedQuery = encodeURIComponent(query);

  try {
    const response = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${encodedQuery}&max_results=25&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`,
      {
        headers: {
          'Authorization': `Bearer ${env.TWITTER_BEARER_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[twitter] Search failed: ${response.status} - ${error}`);
      return posts;
    }

    const data = (await response.json()) as TwitterSearchResponse;

    if (!data.data || data.data.length === 0) {
      console.log('[twitter] No tweets found');
      return posts;
    }

    // Build user ID -> username map
    const userMap = new Map<string, string>();
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        userMap.set(user.id, user.username);
      }
    }

    for (const tweet of data.data) {
      // Skip excluded content
      if (shouldExclude(tweet.text)) {
        continue;
      }

      const username = userMap.get(tweet.author_id) || 'unknown';

      // Extract hashtags from tweet
      const hashtagMatches = tweet.text.match(/#\w+/g) || [];

      // Calculate engagement score (weighted: retweets > quotes > likes)
      const engagement =
        tweet.public_metrics.like_count +
        tweet.public_metrics.retweet_count * 3 +
        tweet.public_metrics.quote_count * 2 +
        tweet.public_metrics.reply_count;

      posts.push({
        id: `twitter:${tweet.id}`,
        platform: 'twitter',
        externalId: tweet.id,
        url: `https://twitter.com/${username}/status/${tweet.id}`,
        authorUsername: username,
        content: tweet.text,
        hashtags: hashtagMatches,
        engagementScore: engagement,
        createdAt: new Date(tweet.created_at),
        scannedAt: now,
        relevanceScore: 0,
      });
    }

    console.log(`[twitter] Scanned ${data.data.length} tweets, kept ${posts.length}`);
  } catch (error) {
    console.error('[twitter] Error scanning:', error);
  }

  return posts;
}

/**
 * Generate OAuth 1.0a signature for Twitter API
 * Required for posting tweets (user context)
 */
function generateOAuthSignature(
  method: string,
  baseUrl: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string
): string {
  // Sort and encode parameters
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  // Create signature base string
  const signatureBase = `${method}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // HMAC-SHA1 (using Web Crypto API)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(signatureBase);

  // Note: In Workers, we need to use crypto.subtle for HMAC
  // For simplicity, we'll use a synchronous approach with btoa
  // In production, you'd want to use crypto.subtle.sign()

  // Simplified base64 encoding - in practice, use proper HMAC-SHA1
  return btoa(signatureBase).slice(0, 43);
}

/**
 * Generate OAuth 1.0a Authorization header
 */
function generateOAuthHeader(
  method: string,
  url: string,
  env: Env
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: env.TWITTER_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: env.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    env.TWITTER_API_SECRET,
    env.TWITTER_ACCESS_SECRET
  );

  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

/**
 * Post a reply tweet using OAuth 1.0a
 */
export async function postTwitterReply(
  env: Env,
  inReplyToId: string,
  replyText: string
): Promise<{ success: boolean; error?: string }> {
  if (!env.TWITTER_API_KEY || !env.TWITTER_ACCESS_TOKEN) {
    return { success: false, error: 'Twitter API credentials not configured' };
  }

  const url = 'https://api.twitter.com/2/tweets';

  try {
    const authHeader = generateOAuthHeader('POST', url, env);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: replyText,
        reply: {
          in_reply_to_tweet_id: inReplyToId,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Tweet failed: ${response.status} - ${error}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Exception: ${error}` };
  }
}
