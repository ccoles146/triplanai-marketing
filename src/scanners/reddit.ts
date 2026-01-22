import type { Env } from '../lib/env';
import type { SocialPost } from '../lib/types';
import { getSubreddits, EXCLUDE_PATTERNS } from '../lib/keywords';

interface RedditOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RSSItem {
  id: string;
  title: string;
  content: string;
  author: string;
  subreddit: string;
  permalink: string;
  created: Date;
  score?: number;
  numComments?: number;
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
 * Parse Reddit RSS feed XML
 */
function parseRedditRSS(xmlText: string, subreddit: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Simple XML parsing using regex (for basic RSS feeds)
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  const entries = xmlText.matchAll(entryPattern);

  for (const entryMatch of entries) {
    const entry = entryMatch[1];

    // Extract fields
    const id = entry.match(/<id>.*\/comments\/([^/]+)/)?.[1];
    const title = entry.match(/<title>(.*?)<\/title>/)?.[1];
    const author = entry.match(/<name>(.*?)<\/name>/)?.[1];
    const updated = entry.match(/<updated>(.*?)<\/updated>/)?.[1];
    const link = entry.match(/<link href="([^"]+)"/)?.[1];
    const contentMatch = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1];

    if (!id || !title || !author) continue;

    // Extract text content and remove HTML tags
    let content = '';
    if (contentMatch) {
      // Remove CDATA wrapper
      const cdataContent = contentMatch.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1');
      // Extract text from HTML (basic approach)
      content = cdataContent
        .replace(/<[^>]+>/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      // Try to extract just the post text (before comments section)
      const submittedMatch = content.match(/submitted by.*?to r\/\w+\s+(.*?)(?:\[link\]|\[comments\]|$)/s);
      if (submittedMatch) {
        content = submittedMatch[1].trim();
      }
    }

    items.push({
      id: id,
      title: decodeHTML(title),
      content: content,
      author: author.replace(/^\/u\//, ''),
      subreddit: subreddit,
      permalink: link || '',
      created: updated ? new Date(updated) : new Date(),
    });
  }

  return items;
}

/**
 * Decode HTML entities
 */
function decodeHTML(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Scan Reddit via RSS feeds (no authentication required)
 */
async function scanRedditViaRSS(subreddit: string): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  const now = new Date();

  try {
    const rssUrl = `https://www.reddit.com/r/${subreddit}/new.rss?limit=25`;
    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TriPlanAI-Marketing/2.0)',
      },
    });

    if (!response.ok) {
      console.error(`[reddit-rss] Failed to fetch r/${subreddit}: ${response.status}`);
      return posts;
    }

    const xmlText = await response.text();
    const items = parseRedditRSS(xmlText, subreddit);

    for (const item of items) {
      // Skip excluded content
      if (shouldExclude(item.title, item.content)) {
        continue;
      }

      // Skip deleted users
      if (item.author === '[deleted]') {
        continue;
      }

      posts.push({
        id: `reddit:${item.id}`,
        platform: 'reddit',
        externalId: item.id,
        url: item.permalink,
        authorUsername: item.author,
        content: item.content,
        title: item.title,
        subreddit: item.subreddit,
        engagementScore: 0, // RSS feeds don't include score/comments
        createdAt: item.created,
        scannedAt: now,
        relevanceScore: 0,
      });
    }

    console.log(`[reddit-rss] Scanned r/${subreddit}: ${items.length} posts`);
  } catch (error) {
    console.error(`[reddit-rss] Error scanning r/${subreddit}:`, error);
  }

  return posts;
}

/**
 * Scan Reddit subreddits for triathlon-related posts
 * Uses API if credentials available, otherwise falls back to RSS feeds
 */
export async function scanReddit(env: Env): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  // Check if we should use API or RSS
  const hasAPICredentials = env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT;

  // Get configured subreddits
  const subreddits = getSubreddits();

  if (!hasAPICredentials) {
    console.log('[reddit] No API credentials - using RSS feeds');

    // Scan via RSS (no authentication required)
    for (const subreddit of subreddits) {
      const rssPosts = await scanRedditViaRSS(subreddit);
      posts.push(...rssPosts);
    }

    return posts;
  }

  // Use API method
  console.log('[reddit] Using API method');
  const accessToken = await getAccessToken(env);
  const now = new Date();

  for (const subreddit of subreddits) {
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
 * Generate a pre-filled Reddit reply URL
 * Opens Reddit comment page where user can paste and submit the reply
 */
export function generateRedditReplyUrl(postId: string, postUrl: string): string {
  // Reddit doesn't support pre-filled text in URLs, so we just return the post URL
  // User will need to copy the reply text and paste it manually
  return postUrl;
}

/**
 * Post a reply to a Reddit post
 * Supports both API posting (if credentials available) and URL generation for manual posting
 */
export async function postRedditReply(
  env: Env,
  postId: string,
  replyText: string,
  postUrl?: string
): Promise<{ success: boolean; error?: string; url?: string }> {
  // Check if we have API credentials for automatic posting
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    // No API credentials - generate URL for manual posting if username is available
    if (env.REDDIT_USERNAME && postUrl) {
      return {
        success: false,
        error: 'Manual posting required',
        url: generateRedditReplyUrl(postId, postUrl),
      };
    }
    return { success: false, error: 'Reddit credentials not configured' };
  }

  // Check if we have user credentials for posting
  if (!env.REDDIT_USERNAME || !env.REDDIT_PASSWORD) {
    // API creds exist but no user creds - generate URL for manual posting
    if (postUrl) {
      return {
        success: false,
        error: 'Manual posting required',
        url: generateRedditReplyUrl(postId, postUrl),
      };
    }
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
