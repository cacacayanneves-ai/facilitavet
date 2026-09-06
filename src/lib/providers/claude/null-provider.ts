import type { ClaudeProvider } from './types';

/**
 * Provider inerte usado quando nao ha ANTHROPIC_API_KEY ou quando o recurso
 * esta desligado. Existe para que o resto do codigo nunca precise de
 * `if (claude)` — o fallback e um objeto, nao um null espalhado pelo sistema.
 */
export class NullClaudeProvider implements ClaudeProvider {
  readonly name = 'disabled';
  readonly available = false;
  async analyzeRoute() {
    return null;
  }
  async analyzeMonth() {
    return null;
  }
}
