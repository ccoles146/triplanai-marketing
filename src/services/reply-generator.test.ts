import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateReply,
  createGeneratedReply,
  generateReplies,
  generateCrossPost,
  generateFacebookPost,
} from './reply-generator';
import {
  createMockRedditPost,
  createMockTwitterPost,
  createMockInstagramPost,
} from '../test/mocks';

// Mock the Ollama service
vi.mock('./ollama', () => ({
  chat: vi.fn(),
}));

import { chat } from './ollama';

describe('Reply Generator Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateReply', () => {
    it('should generate a reply for a Reddit post', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Great question! For your first triathlon, focus on building a solid base in all three disciplines.'
      );

      const post = createMockRedditPost();
      const reply = await generateReply(post);

      expect(reply).toBe(
        'Great question! For your first triathlon, focus on building a solid base in all three disciplines.'
      );

      // Verify Ollama was called with correct parameters
      expect(chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        { maxTokens: 300 }
      );

      // Verify Reddit-specific instructions were included
      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('reddit');
      expect(userMessage).toContain('2-4 sentences');
      expect(userMessage).toContain('No emojis');
    });

    it('should generate a reply for a Twitter post', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Nice brick workout! 💪 Keep pushing through that jelly-legs feeling. #triathlon'
      );

      const post = createMockTwitterPost();
      const reply = await generateReply(post);

      expect(reply).toContain('brick workout');

      // Verify Twitter-specific instructions were included
      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('twitter');
      expect(userMessage).toContain('280 characters');
    });

    it('should generate a reply for an Instagram post', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Good luck on your Ironman journey! 🏊‍♂️🚴‍♂️🏃‍♂️ Start with whole foods and practice your race nutrition in training. #ironman'
      );

      const post = createMockInstagramPost();
      const reply = await generateReply(post);

      expect(reply).toBeDefined();

      // Verify Instagram-specific instructions
      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('instagram');
      expect(userMessage).toContain('Friendly');
      expect(userMessage).toContain('Emojis are welcome');
    });

    it('should strip surrounding quotes from response', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        '"This is a quoted response"'
      );

      const post = createMockRedditPost();
      const reply = await generateReply(post);

      expect(reply).toBe('This is a quoted response');
    });

    it('should handle single quotes too', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        "'Another quoted response'"
      );

      const post = createMockRedditPost();
      const reply = await generateReply(post);

      expect(reply).toBe('Another quoted response');
    });

    it('should shorten Twitter replies that exceed 280 characters', async () => {
      // First call returns long response
      (chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(
          'This is a very long response that definitely exceeds the Twitter character limit of 280 characters. It contains so much helpful information about triathlon training that it would be impossible to fit it all in a single tweet without some creative editing and shortening of the content.'
        )
        .mockResolvedValueOnce('Shortened response under 280 chars.');

      const post = createMockTwitterPost();
      const reply = await generateReply(post);

      // Should have called chat twice (original + shorten)
      expect(chat).toHaveBeenCalledTimes(2);
      expect(reply).toBe('Shortened response under 280 chars.');
    });

    it('should hard truncate if shortened reply still exceeds limit', async () => {
      (chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('x'.repeat(300))
        .mockResolvedValueOnce('y'.repeat(300)); // Still too long

      const post = createMockTwitterPost();
      const reply = await generateReply(post);

      expect(reply.length).toBeLessThanOrEqual(280);
      expect(reply.endsWith('...')).toBe(true);
    });

    it('should include post context in the prompt', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('Test reply');

      const post = createMockRedditPost({
        title: 'Specific Post Title',
        content: 'Specific post content about triathlon',
        authorUsername: 'specific_user',
        subreddit: 'triathlon',
      });

      await generateReply(post);

      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('Specific Post Title');
      expect(userMessage).toContain('Specific post content about triathlon');
      expect(userMessage).toContain('@specific_user');
      expect(userMessage).toContain('r/triathlon');
    });

    it('should include hashtags for Twitter posts', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('Test reply');

      const post = createMockTwitterPost({
        hashtags: ['#triathlon', '#ironman', '#swimbikerun'],
      });

      await generateReply(post);

      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('#triathlon');
      expect(userMessage).toContain('#ironman');
    });
  });

  describe('createGeneratedReply', () => {
    it('should create a full GeneratedReply object', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('Generated reply text');

      const post = createMockRedditPost();
      const reply = await createGeneratedReply(post);

      expect(reply.postId).toBe(post.id);
      expect(reply.platform).toBe('reddit');
      expect(reply.originalPost).toBe(post);
      expect(reply.replyText).toBe('Generated reply text');
      expect(reply.status).toBe('pending');
      expect(reply.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('generateReplies', () => {
    it('should generate replies for multiple posts', async () => {
      (chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Reply 1')
        .mockResolvedValueOnce('Reply 2')
        .mockResolvedValueOnce('Reply 3');

      const posts = [
        createMockRedditPost({ id: 'reddit:1' }),
        createMockRedditPost({ id: 'reddit:2' }),
        createMockRedditPost({ id: 'reddit:3' }),
      ];

      const replies = await generateReplies(posts);

      expect(replies).toHaveLength(3);
      expect(replies[0].replyText).toBe('Reply 1');
      expect(replies[1].replyText).toBe('Reply 2');
      expect(replies[2].replyText).toBe('Reply 3');
    });

    it('should continue on error for individual posts', async () => {
      (chat as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('Reply 1')
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce('Reply 3');

      const posts = [
        createMockRedditPost({ id: 'reddit:1' }),
        createMockRedditPost({ id: 'reddit:2' }),
        createMockRedditPost({ id: 'reddit:3' }),
      ];

      const replies = await generateReplies(posts);

      // Should have 2 successful replies (post 2 failed)
      expect(replies).toHaveLength(2);
      expect(replies[0].postId).toBe('reddit:1');
      expect(replies[1].postId).toBe('reddit:3');
    });

    it('should return empty array for empty input', async () => {
      const replies = await generateReplies([]);

      expect(replies).toEqual([]);
      expect(chat).not.toHaveBeenCalled();
    });
  });

  describe('generateCrossPost', () => {
    it('should generate a Reddit cross-post with title and body', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'TITLE: Triathlon Training Tip: Building Your First Base Phase\nBODY: We helped someone on Twitter with this training question. Check out the discussion!\n\n> Original question\n\nOur response here.'
      );

      const post = createMockTwitterPost({
        content: 'How do I start training for triathlon?',
      });

      const crossPost = await generateCrossPost(post, 'Start with 3 days a week');

      expect(crossPost.title).toBe('Triathlon Training Tip: Building Your First Base Phase');
      expect(crossPost.body).toContain('We helped someone');
    });

    it('should use platform name X for Twitter', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'TITLE: Test\nBODY: Content'
      );

      const post = createMockTwitterPost();
      await generateCrossPost(post, 'Reply text');

      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('on X');
    });

    it('should provide fallback title and body on parse failure', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Malformed response without proper format'
      );

      const post = createMockRedditPost({
        content: 'Original question content',
      });

      const crossPost = await generateCrossPost(post, 'Our helpful reply');

      expect(crossPost.title).toContain('Triathlon tip');
      expect(crossPost.body).toContain('Original question content');
      expect(crossPost.body).toContain('Our helpful reply');
    });
  });

  describe('generateFacebookPost', () => {
    it('should generate a Facebook post from Q&A', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue(
        "Here's a training tip from our community: Start with consistency over intensity. What's your approach? 🏊‍♂️🚴‍♂️🏃‍♂️"
      );

      const post = createMockRedditPost({
        content: 'How should I start triathlon training?',
      });

      const fbPost = await generateFacebookPost(post, 'Start with 3 days a week');

      expect(fbPost).toContain('training tip');
      expect(fbPost).toContain('🏊‍♂️');
    });

    it('should provide fallback on empty response', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('');

      const post = createMockRedditPost();
      const fbPost = await generateFacebookPost(post, 'Our reply text');

      expect(fbPost).toContain('Training tip of the day');
      expect(fbPost).toContain('Our reply text');
    });

    it('should include engagement question in prompt', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('Facebook post');

      const post = createMockRedditPost();
      await generateFacebookPost(post, 'Reply');

      const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][1].content;
      expect(userMessage).toContain('question to encourage comments');
    });
  });

  describe('system prompt', () => {
    it('should include a system message with substantial content', async () => {
      (chat as ReturnType<typeof vi.fn>).mockResolvedValue('Reply');

      await generateReply(createMockRedditPost());

      const systemMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][0][0].content;
      expect(systemMessage).toBeDefined();
      expect(systemMessage.length).toBeGreaterThan(50); // Has substantial content
      expect(systemMessage).toBeTruthy();
    });
  });
});
