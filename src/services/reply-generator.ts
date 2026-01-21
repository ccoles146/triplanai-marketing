import type { SocialPost, GeneratedReply, SocialPlatform } from '../lib/types';
import { chat } from './ollama';

const SYSTEM_PROMPT = `You are a helpful triathlon coach and enthusiast named TriPlanAI. Your goal is to provide genuine, helpful replies to triathlon-related social media posts.

Guidelines:
1. Be friendly, encouraging, and authentic
2. Provide specific, actionable advice when possible
3. Keep replies concise - match the platform's style
4. Never be promotional or salesy
5. Reference the specific question or topic from the original post
6. Include a relevant training tip when appropriate
7. Use appropriate tone for the platform
8. Output plain text only - NO HTML tags, NO comments, NO markdown formatting

DO NOT:
- Mention that you're an AI or bot
- Include links unless specifically asked
- Use excessive hashtags
- Be generic - always personalize based on the post content
- Start replies with "Great question!" or similar clichés
- Use HTML tags, HTML comments (<!-- -->), or any markup language
- Use markdown formatting like ** or __`;

const PLATFORM_INSTRUCTIONS: Record<SocialPlatform, string> = {
  reddit: `Format for Reddit:
- 2-4 sentences, conversational
- Use casual, community-focused tone like a fellow r/triathlon member
- No emojis
- Can include bullet points for tips
- Sign off informally if appropriate`,

  twitter: `Format for Twitter/X:
- MUST be under 280 characters total
- Be concise and punchy
- Can use 1-2 relevant hashtags at the end
- Light emoji use is okay (1-2 max)`,

  instagram: `Format for Instagram:
- 2-3 sentences
- Friendly, positive, encouraging tone
- Can use 2-3 relevant hashtags at the end
- Emojis are welcome but don't overdo it`,
};

/**
 * Generate an AI reply for a social media post
 */
export async function generateReply(post: SocialPost): Promise<string> {
  const platformInstructions = PLATFORM_INSTRUCTIONS[post.platform];

  const userPrompt = `Generate a reply to this ${post.platform} post about triathlon:

${post.title ? `Title: ${post.title}\n` : ''}Content: ${post.content}

Author: @${post.authorUsername}
${post.subreddit ? `Subreddit: r/${post.subreddit}` : ''}
${post.hashtags?.length ? `Hashtags: ${post.hashtags.join(' ')}` : ''}

${platformInstructions}

Respond with ONLY the reply text, nothing else. No quotes, no "Here's a reply:", just the actual reply.`;

  let replyText = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { maxTokens: 300 });

  // Remove any surrounding quotes the model might add
  replyText = replyText.replace(/^["']|["']$/g, '').trim();

  // Enforce Twitter character limit
  if (post.platform === 'twitter' && replyText.length > 280) {
    replyText = await shortenForTwitter(replyText);
  }

  return replyText;
}

/**
 * Shorten a reply for Twitter's character limit
 */
async function shortenForTwitter(text: string): Promise<string> {
  let shortened = await chat([
    {
      role: 'system',
      content: 'You shorten text while preserving the key message. Output only the shortened text.',
    },
    {
      role: 'user',
      content: `Shorten this to under 280 characters while keeping the key message:\n\n"${text}"\n\nRespond with ONLY the shortened text.`,
    },
  ], { maxTokens: 150 });

  // Hard truncate if still too long
  if (shortened.length > 280) {
    shortened = shortened.slice(0, 277) + '...';
  }

  return shortened;
}

/**
 * Generate a full GeneratedReply object
 */
export async function createGeneratedReply(post: SocialPost): Promise<GeneratedReply> {
  const replyText = await generateReply(post);

  return {
    postId: post.id,
    platform: post.platform,
    originalPost: post,
    replyText,
    generatedAt: new Date(),
    status: 'pending',
  };
}

/**
 * Generate replies for multiple posts
 */
export async function generateReplies(posts: SocialPost[]): Promise<GeneratedReply[]> {
  const replies: GeneratedReply[] = [];

  for (const post of posts) {
    try {
      const reply = await createGeneratedReply(post);
      replies.push(reply);
    } catch (error) {
      console.error(`[reply-generator] Failed for ${post.id}:`, error);
    }
  }

  return replies;
}

/**
 * Generate a cross-post for r/triplanai
 */
export async function generateCrossPost(
  originalPost: SocialPost,
  ourReply: string
): Promise<{ title: string; body: string }> {
  const platformName = originalPost.platform === 'twitter' ? 'X' : originalPost.platform;

  const text = await chat([
    {
      role: 'system',
      content: 'You create engaging Reddit post titles and bodies. Keep titles under 100 characters. Be helpful and community-focused.',
    },
    {
      role: 'user',
      content: `Create a Reddit post for r/triplanai sharing a helpful response we gave to someone on ${platformName}.

Original question: "${originalPost.title || originalPost.content}"
Our response: "${ourReply}"

Format your response as:
TITLE: [engaging title under 100 chars]
BODY: [2-3 sentence intro inviting discussion, then quote the original question and our response]`,
    },
  ], { maxTokens: 400 });

  // Parse title and body
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);

  const title = titleMatch?.[1]?.trim() || `Triathlon tip from ${platformName}`;
  const body = bodyMatch?.[1]?.trim() || `We helped someone on ${platformName} with this:\n\n> ${originalPost.content}\n\nOur response: ${ourReply}\n\nWhat are your thoughts?`;

  return { title, body };
}

/**
 * Generate a Facebook post for cross-posting
 */
export async function generateFacebookPost(
  originalPost: SocialPost,
  ourReply: string
): Promise<string> {
  const text = await chat([
    {
      role: 'system',
      content: 'You create engaging Facebook posts for a triathlon coaching page. Be helpful, encouraging, and invite engagement.',
    },
    {
      role: 'user',
      content: `Create a Facebook post sharing triathlon advice. Base it on this Q&A:

Question: "${originalPost.title || originalPost.content}"
Our advice: "${ourReply}"

Make it feel like original content, not a repost. End with a question to encourage comments. Use 1-2 emojis. Keep it under 500 characters.

Respond with ONLY the Facebook post text.`,
    },
  ], { maxTokens: 300 });

  return text || `Training tip of the day:\n\n${ourReply}\n\nWhat's your experience? 🏊‍♂️🚴‍♂️🏃‍♂️`;
}
