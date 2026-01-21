import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendApprovalRequest,
  sendInstagramOpportunity,
  updateMessageStatus,
  answerCallbackQuery,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  sendNotification,
  decodeCallbackData,
} from './telegram';
import {
  createMockGeneratedReply,
  createMockRedditPost,
  createMockTwitterPost,
  createMockInstagramPost,
  mockTelegramResponses,
  createMockFetchResponse,
} from '../test/mocks';

// Mock the env module
vi.mock('../lib/env', () => ({
  getEnv: vi.fn(() => ({
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: 'test-chat-id',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Telegram Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('decodeCallbackData', () => {
    it('should decode valid callback data', () => {
      const result = decodeCallbackData('approve:reddit:abc123:reddit');

      expect(result).toEqual({
        action: 'approve',
        postId: 'reddit:abc123',
        platform: 'reddit',
      });
    });

    it('should handle approve_crosspost action', () => {
      const result = decodeCallbackData('approve_crosspost:twitter:1234567890:twitter');

      expect(result).toEqual({
        action: 'approve_crosspost',
        postId: 'twitter:1234567890',
        platform: 'twitter',
      });
    });

    it('should handle decline action', () => {
      const result = decodeCallbackData('decline:instagram:ig123:instagram');

      expect(result).toEqual({
        action: 'decline',
        postId: 'instagram:ig123',
        platform: 'instagram',
      });
    });

    it('should handle mark_done action', () => {
      const result = decodeCallbackData('mark_done:instagram:ig456:instagram');

      expect(result).toEqual({
        action: 'mark_done',
        postId: 'instagram:ig456',
        platform: 'instagram',
      });
    });

    it('should return null for invalid data format', () => {
      expect(decodeCallbackData('invalid')).toBeNull();
      expect(decodeCallbackData('only:two')).toBeNull();
    });

    it('should return null for invalid action', () => {
      const result = decodeCallbackData('unknown_action:postid:platform');

      expect(result).toBeNull();
    });

    it('should handle post IDs containing colons', () => {
      const result = decodeCallbackData('approve:platform:complex:id:with:colons:reddit');

      expect(result).toEqual({
        action: 'approve',
        postId: 'platform:complex:id:with:colons',
        platform: 'reddit',
      });
    });
  });

  describe('sendApprovalRequest', () => {
    it('should send approval message for Reddit post', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const post = createMockRedditPost();
      const reply = createMockGeneratedReply(post);

      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('12345');

      // Verify request
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('api.telegram.org/bottest-bot-token/sendMessage');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.chat_id).toBe('test-chat-id');
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('REDDIT Opportunity');
      expect(body.text).toContain('r/triathlon');
      expect(body.text).toContain('Draft Reply');
    });

    it('should send approval message for Twitter post', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const post = createMockTwitterPost();
      const reply = createMockGeneratedReply(post);

      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('TWITTER Opportunity');
      expect(body.text).toContain('@triathlonfan');
    });

    it('should include inline keyboard with approve/decline buttons', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const reply = createMockGeneratedReply();
      await sendApprovalRequest(reply);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const keyboard = body.reply_markup.inline_keyboard;

      expect(keyboard).toHaveLength(2); // Two rows
      expect(keyboard[0]).toHaveLength(2); // First row: Reply Only + Reply + Cross-post
      expect(keyboard[1]).toHaveLength(1); // Second row: Skip

      // Verify button texts
      expect(keyboard[0][0].text).toContain('Reply Only');
      expect(keyboard[0][1].text).toContain('Cross-post');
      expect(keyboard[1][0].text).toContain('Skip');
    });

    it('should handle API failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ ok: false, description: 'Chat not found' })
      );

      const reply = createMockGeneratedReply();
      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send message');
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const reply = createMockGeneratedReply();
      const result = await sendApprovalRequest(reply);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should disable web page preview', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const reply = createMockGeneratedReply();
      await sendApprovalRequest(reply);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.disable_web_page_preview).toBe(true);
    });
  });

  describe('sendInstagramOpportunity', () => {
    it('should send Instagram opportunity with mark_done button', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const post = createMockInstagramPost();
      const reply = createMockGeneratedReply(post);

      const result = await sendInstagramOpportunity(reply);

      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Instagram Opportunity');
      expect(body.text).toContain('manually');

      const keyboard = body.reply_markup.inline_keyboard;
      expect(keyboard[0][0].text).toContain('Mark as Done');
    });

    it('should enable web page preview for Instagram links', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const post = createMockInstagramPost();
      const reply = createMockGeneratedReply(post);
      await sendInstagramOpportunity(reply);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.disable_web_page_preview).toBe(false);
    });
  });

  describe('updateMessageStatus', () => {
    it('should remove keyboard and send status reply', async () => {
      // Mock editMessageReplyMarkup
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.editMessageReplyMarkup)
      );

      // Mock sendMessage (status reply)
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      await updateMessageStatus('12345', 'posted', 'by @testuser');

      // Verify editMessageReplyMarkup call
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const editCall = mockFetch.mock.calls[0];
      expect(editCall[0]).toContain('editMessageReplyMarkup');
      const editBody = JSON.parse(editCall[1].body);
      expect(editBody.message_id).toBe(12345);
      expect(editBody.reply_markup.inline_keyboard).toEqual([]);

      // Verify status reply
      const replyCall = mockFetch.mock.calls[1];
      const replyBody = JSON.parse(replyCall[1].body);
      expect(replyBody.reply_to_message_id).toBe(12345);
      expect(replyBody.text).toContain('Posted');
      expect(replyBody.text).toContain('by @testuser');
    });

    it('should use correct emoji for each status', async () => {
      const statuses = [
        { status: 'approved', emoji: '✅' },
        { status: 'declined', emoji: '❌' },
        { status: 'posted', emoji: '🚀' },
        { status: 'failed', emoji: '⚠️' },
        { status: 'done', emoji: '✅' },
      ] as const;

      for (const { status, emoji } of statuses) {
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockTelegramResponses.editMessageReplyMarkup)
        );
        mockFetch.mockResolvedValueOnce(
          createMockFetchResponse(mockTelegramResponses.sendMessage)
        );

        await updateMessageStatus('123', status);

        const replyBody = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
        expect(replyBody.text).toContain(emoji);
      }
    });
  });

  describe('answerCallbackQuery', () => {
    it('should acknowledge callback query', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.answerCallbackQuery)
      );

      await answerCallbackQuery('callback123', 'Processing...');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('answerCallbackQuery');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.callback_query_id).toBe('callback123');
      expect(body.text).toBe('Processing...');
    });

    it('should use default text when not provided', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.answerCallbackQuery)
      );

      await answerCallbackQuery('callback456');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Processing...');
    });
  });

  describe('setWebhook', () => {
    it('should set webhook URL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.setWebhook)
      );

      const result = await setWebhook('https://example.com/webhook/telegram');

      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.url).toBe('https://example.com/webhook/telegram');
      expect(body.secret_token).toBe('test-secret');
      expect(body.allowed_updates).toEqual(['callback_query']);
    });

    it('should handle webhook setup failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          ok: false,
          description: 'Bad webhook URL',
        })
      );

      const result = await setWebhook('invalid-url');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bad webhook URL');
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.deleteWebhook)
      );

      const result = await deleteWebhook();

      expect(result).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toContain('deleteWebhook');
    });

    it('should return false on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ ok: false })
      );

      const result = await deleteWebhook();

      expect(result).toBe(false);
    });
  });

  describe('getWebhookInfo', () => {
    it('should return webhook info', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.getWebhookInfo)
      );

      const result = await getWebhookInfo();

      expect(result).toEqual({
        url: 'https://example.com/webhook/telegram',
        has_custom_certificate: false,
        pending_update_count: 0,
      });
    });

    it('should return null on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ ok: false })
      );

      const result = await getWebhookInfo();

      expect(result).toBeNull();
    });
  });

  describe('sendNotification', () => {
    it('should send simple notification', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockTelegramResponses.sendMessage)
      );

      const result = await sendNotification('Test notification message');

      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Test notification message');
      expect(body.chat_id).toBe('test-chat-id');
    });

    it('should return false on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ ok: false, description: 'Error' })
      );

      const result = await sendNotification('Test');

      expect(result).toBe(false);
    });
  });
});
