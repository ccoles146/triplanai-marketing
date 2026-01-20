import { Ollama } from 'ollama';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

let client: Ollama | null = null;

/**
 * Get or create the Ollama client
 */
function getClient(): Ollama {
  if (!client) {
    client = new Ollama({ host: OLLAMA_HOST });
  }
  return client;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
}

/**
 * Generate a chat completion using Ollama
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const ollama = getClient();
  const model = options.model || DEFAULT_MODEL;

  const response = await ollama.chat({
    model,
    messages,
    options: {
      num_predict: options.maxTokens || 300,
    },
  });

  return response.message.content.trim();
}

/**
 * Check if Ollama is available and the model is loaded
 */
export async function checkHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const ollama = getClient();
    const models = await ollama.list();
    const modelName = DEFAULT_MODEL.split(':')[0];
    const hasModel = models.models.some((m) => m.name.startsWith(modelName));

    if (!hasModel) {
      return {
        ok: false,
        error: `Model ${DEFAULT_MODEL} not found. Run: ollama pull ${DEFAULT_MODEL}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Cannot connect to Ollama at ${OLLAMA_HOST}: ${error}`,
    };
  }
}
