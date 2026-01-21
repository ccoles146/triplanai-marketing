import type { Env } from '../lib/env';
import type { SocialPost } from '../lib/types';
import { SUBREDDITS, EXCLUDE_PATTERNS } from '../lib/keywords';

interface RedditOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RedditListingResponse {
  data: {
    children: Array<{
      data: {
        id: string;
        title: string;
        selftext: string;
        author: string;
        subreddit: string;
        permalink: string;
        score: number;
        created_utc: number;
        num_comments: number;
      };
    }>;
  };
}

// Cache token in memory (worker-scoped, resets on cold start)
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Clear the cached OAuth token (useful for testing)
 */
export function clearTokenCache(): void {
  cachedToken = null;
}

/**
 * Get Reddit OAuth access token using client credentials
 */
async function getAccessToken(env: Env): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);

  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Reddit OAuth failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as RedditOAuthResponse;

  // Cache with 1 minute buffer before expiry
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return data.access_token;
}

/**
 * Check if post content matches exclusion patterns (spam, sales, etc.)
 */
function shouldExclude(title: string, content: string): boolean {
  const combined = `${title} ${content}`;
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Scan Reddit subreddits for triathlon-related posts
 */
export async function scanReddit(env: Env): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  // Check for required credentials
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET || !env.REDDIT_USER_AGENT) {
    console.log('[reddit] No credentials found - skipping');
    return posts;
  }

  const accessToken = await getAccessToken(env);
  const now = new Date();

  for (const subreddit of SUBREDDITS) {
    try {
      // Fetch new posts from subreddit
      const response = await fetch(
        `https://oauth.reddit.com/r/${subreddit}/new?limit=25`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': env.REDDIT_USER_AGENT,
          },
        }
      );

      if (!response.ok) {
        console.error(`[reddit] Failed to fetch r/${subreddit}: ${response.status}`);
        continue;
      }

      const data = (await response.json()) as RedditListingResponse;

      for (const child of data.data.children) {
        const post = child.data;

        // Skip excluded content
        if (shouldExclude(post.title, post.selftext)) {
          continue;
        }

        // Skip posts by deleted users
        if (post.author === '[deleted]') {
          continue;
        }

        posts.push({
          id: `reddit:${post.id}`,
          platform: 'reddit',
          externalId: post.id,
          url: `https://reddit.com${post.permalink}`,
          authorUsername: post.author,
          content: post.selftext || '',
          title: post.title,
          subreddit: post.subreddit,
          engagementScore: post.score + post.num_comments,
          createdAt: new Date(post.created_utc * 1000),
          scannedAt: now,
          relevanceScore: 0, // Will be calculated by ranking service
        });
      }

      console.log(`[reddit] Scanned r/${subreddit}: ${data.data.children.length} posts`);
    } catch (error) {
      console.error(`[reddit] Error scanning r/${subreddit}:`, error);
    }
  }

  return posts;
}

/**
 * Post a reply to a Reddit post
 * Requires user authentication (username/password OAuth flow)
 */
export async function postRedditReply(
  env: Env,
  postId: string,
  replyText: string
): Promise<{ success: boolean; error?: string }> {
  // Reddit requires password grant for posting on behalf of a user
  if (!env.REDDIT_USERNAME || !env.REDDIT_PASSWORD) {
    return { success: false, error: 'Reddit username/password not configured' };
  }

  const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);

  // Get user token via password grant
  const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: env.REDDIT_USERNAME,
      password: env.REDDIT_PASSWORD,
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    return { success: false, error: `Auth failed: ${error}` };
  }

  const tokenData = (await tokenResponse.json()) as RedditOAuthResponse;

  // Post the comment
  const commentResponse = await fetch('https://oauth.reddit.com/api/comment', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      thing_id: `t3_${postId}`, // t3_ prefix for posts, t1_ for comments
      text: replyText,
    }),
  });

  if (!commentResponse.ok) {
    const error = await commentResponse.text();
    return { success: false, error: `Comment failed: ${error}` };
  }

  return { success: true };
}

/**
 * Post to r/triplanai subreddit (cross-posting)
 */
export async function postToTriplanaiSubreddit(
  env: Env,
  title: string,
  body: string
): Promise<{ success: boolean; error?: string; url?: string }> {
  if (!env.REDDIT_USERNAME || !env.REDDIT_PASSWORD) {
    return { success: false, error: 'Reddit username/password not configured' };
  }

  const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);

  // Get user token
  const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: env.REDDIT_USERNAME,
      password: env.REDDIT_PASSWORD,
    }),
  });

  if (!tokenResponse.ok) {
    return { success: false, error: 'Auth failed' };
  }

  const tokenData = (await tokenResponse.json()) as RedditOAuthResponse;

  // Submit the post
  const submitResponse = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': env.REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
      sr: 'triplanai',
      kind: 'self',
      title,
      text: body,
    }),
  });

  if (!submitResponse.ok) {
    const error = await submitResponse.text();
    return { success: false, error: `Submit failed: ${error}` };
  }

  const result = (await submitResponse.json()) as { json: { data: { url: string } } };
  return { success: true, url: result.json?.data?.url };
}
