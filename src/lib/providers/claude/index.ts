import { env } from '@/lib/env';
import { AnthropicClaudeProvider } from './anthropic';
import { NullClaudeProvider } from './null-provider';
import type { ClaudeProvider } from './types';

export * from './types';
export { AnthropicClaudeProvider, NullClaudeProvider };

let cached: ClaudeProvider | null = null;

export function getClaudeProvider(): ClaudeProvider {
  if (cached) return cached;
  const config = env();
  cached =
    config.CLAUDE_ENABLED && config.ANTHROPIC_API_KEY.length > 0
      ? new AnthropicClaudeProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.CLAUDE_MODEL })
      : new NullClaudeProvider();
  return cached;
}

export function resetClaudeProvider(): void {
  cached = null;
}
