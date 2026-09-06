import type {
  ClaudeProvider,
  MonthAnalysisRequest,
  RouteAnalysisRequest,
  RouteAnalysisResult,
} from './types';

/**
 * Provider inerte usado quando nao ha ANTHROPIC_API_KEY ou quando o recurso
 * esta desligado. Existe para que o resto do codigo nunca precise de
 * `if (claude)` — o fallback e um objeto, nao um null espalhado pelo sistema.
 */
export class NullClaudeProvider implements ClaudeProvider {
  readonly name = 'disabled';
  readonly available = false;

  async analyzeRoute(_request: RouteAnalysisRequest): Promise<RouteAnalysisResult | null> {
    return null;
  }

  async analyzeMonth(_request: MonthAnalysisRequest): Promise<RouteAnalysisResult | null> {
    return null;
  }
}
