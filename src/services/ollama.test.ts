import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions that will be used in the mock
const mockChat = vi.fn();
const mockList = vi.fn();

// Mock the ollama module with inline factory that references our mock functions
vi.mock('ollama', () => {
  return {
    Ollama: class MockOllama {
      constructor(_options?: { host?: string }) {}
      chat(...args: unknown[]) { return mockChat(...args); }
      list(...args: unknown[]) { return mockList(...args); }
    },
  };
});

// Import the service functions to test
import { chat, checkHealth } from './ollama';

describe('Ollama Service', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockList.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('chat', () => {
    it('should generate a chat completion', async () => {
      mockChat.mockResolvedValue({
        message: {
          role: 'assistant',
          content: '  This is a helpful response about triathlon training.  ',
        },
      });

      const result = await chat([
        { role: 'system', content: 'You are a helpful triathlon coach.' },
        { role: 'user', content: 'How do I prepare for my first triathlon?' },
      ]);

      expect(result).toBe('This is a helpful response about triathlon training.');
      expect(mockChat).toHaveBeenCalledWith({
        model: 'llama3.1:8b',
        messages: [
          { role: 'system', content: 'You are a helpful triathlon coach.' },
          { role: 'user', content: 'How do I prepare for my first triathlon?' },
        ],
        options: {
          num_predict: 300,
        },
      });
    });

    it('should use custom model when specified', async () => {
      mockChat.mockResolvedValue({
        message: {
          role: 'assistant',
          content: 'Response from custom model',
        },
      });

      await chat(
        [{ role: 'user', content: 'Test' }],
        { model: 'custom-model:latest' }
      );

      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model:latest',
        })
      );
    });

    it('should use custom maxTokens when specified', async () => {
      mockChat.mockResolvedValue({
        message: {
          role: 'assistant',
          content: 'Short response',
        },
      });

      await chat(
        [{ role: 'user', content: 'Test' }],
        { maxTokens: 150 }
      );

      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          options: {
            num_predict: 150,
          },
        })
      );
    });

    it('should trim whitespace from response', async () => {
      mockChat.mockResolvedValue({
        message: {
          role: 'assistant',
          content: '\n\n  Trimmed response  \n\n',
        },
      });

      const result = await chat([{ role: 'user', content: 'Test' }]);

      expect(result).toBe('Trimmed response');
    });

    it('should throw on API error', async () => {
      mockChat.mockRejectedValue(new Error('Connection refused'));

      await expect(
        chat([{ role: 'user', content: 'Test' }])
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('checkHealth', () => {
    it('should return ok when model is available', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'llama3.1:8b', modified_at: new Date().toISOString() },
          { name: 'other-model:latest', modified_at: new Date().toISOString() },
        ],
      });

      const result = await checkHealth();

      expect(result).toEqual({ ok: true });
    });

    it('should return error when model is not found', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'different-model:latest', modified_at: new Date().toISOString() },
        ],
      });

      const result = await checkHealth();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Model llama3.1:8b not found');
    });

    it('should return error when Ollama is unreachable', async () => {
      mockList.mockRejectedValue(new Error('Connection refused'));

      const result = await checkHealth();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot connect to Ollama');
    });

    it('should match model name prefix', async () => {
      mockList.mockResolvedValue({
        models: [
          { name: 'llama3.1:8b-instruct-q4_0', modified_at: new Date().toISOString() },
        ],
      });

      const result = await checkHealth();

      expect(result).toEqual({ ok: true });
    });
  });
});
