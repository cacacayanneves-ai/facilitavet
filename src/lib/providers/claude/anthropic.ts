import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/lib/logger';
import type {
  ClaudeProvider,
  MonthAnalysisRequest,
  RouteAnalysisRequest,
  RouteAnalysisResult,
} from './types';

const SYSTEM_PROMPT = `Voce e o analista do Facilita Vet, um sistema de planejamento de visitas para propagandistas da area veterinaria.

Seu papel e EXPLICAR e COMPARAR decisoes que o motor de roteirizacao ja tomou. Voce nao calcula rotas, nao inventa distancias, nao altera datas e nao decide categorias.

Regras rigidas:
- Use APENAS os numeros fornecidos. Nunca estime, arredonde para outro valor nem crie estatisticas.
- Se um dado nao estiver no payload, diga que nao esta disponivel.
- Quando o payload indicar "estimated: true", trate os numeros como estimativa e diga isso.
- Escreva em portugues do Brasil, tom profissional e direto, na perspectiva pratica de quem dirige o dia inteiro.
- Maximo de 2 frases curtas. Sem listas, sem emojis, sem saudacoes.`;

export class AnthropicClaudeProvider implements ClaudeProvider {
  readonly name = 'anthropic';
  readonly available = true;

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1, timeout: 15_000 });
    this.model = options.model;
  }

  async analyzeRoute(request: RouteAnalysisRequest): Promise<RouteAnalysisResult | null> {
    const best = [...request.candidates].sort((a, b) => b.score - a.score)[0];
    return this.ask(
      `Compare as alternativas de roteiro do dia e explique em ate 2 frases por que a escolhida faz sentido para um propagandista. Dados:\n${JSON.stringify(request, null, 2)}`,
      best?.label,
    );
  }

  async analyzeMonth(request: MonthAnalysisRequest): Promise<RouteAnalysisResult | null> {
    return this.ask(
      `Resuma em ate 2 frases como ficou o planejamento do mes para o propagandista. Dados:\n${JSON.stringify(request, null, 2)}`,
    );
  }

  private async ask(prompt: string, recommendation?: string): Promise<RouteAnalysisResult | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      const summary = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      if (!summary) return null;
      return { summary, recommendation, model: this.model };
    } catch (error) {
      // FALLBACK (secao 49): analise indisponivel nunca derruba o planejamento.
      logger.warn('Claude indisponivel; seguindo sem analise contextual', {
        scope: 'claude',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
