import { vi } from 'vitest';

export const mockChat = vi.fn();
export const mockList = vi.fn();

export class Ollama {
  constructor(_options?: { host?: string }) {
    // Constructor accepts options but doesn't use them
  }
  chat = mockChat;
  list = mockList;
}
