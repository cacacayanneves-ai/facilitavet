'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Feedback de processamento (secao 66).
 *
 * As etapas correspondem as fases reais do motor. A animacao e temporizada no
 * cliente porque a geracao inteira leva menos de 1s — mostrar o progresso real
 * via streaming seria mais complexo do que o usuario percebe. O que importa e
 * comunicar QUE trabalho esta sendo feito, e essas etapas sao as verdadeiras.
 */
const STEPS = [
  'Analisando carteira',
  'Verificando categorias',
  'Localizando clínicas',
  'Analisando regiões',
  'Calculando deslocamentos',
  'Criando grupos',
  'Otimizando rotas',
  'Comparando soluções',
  'Finalizando calendário',
];

export function GenerationProgress() {
  const [current, setCurrent] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((value) => (value < STEPS.length ? value + 1 : value));
    }, 260);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="animate-[rise_0.25s_ease-out]">
      <CardContent className="space-y-2.5">
        <p className="text-sm font-semibold text-ink-900">Preparando seu mês...</p>
        <ul className="space-y-1.5">
          {STEPS.map((step, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <li
                key={step}
                className={cn(
                  'flex items-center gap-2 text-xs transition-colors duration-200',
                  done ? 'text-ink-700' : active ? 'text-ink-800' : 'text-ink-300',
                )}
              >
                {done ? (
                  <Check className="size-3.5 shrink-0 text-[var(--color-positive)] animate-[check_0.3s_ease-out]" strokeWidth={3} />
                ) : active ? (
                  <Spinner className="size-3.5 shrink-0 text-brand-600" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                {step}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
