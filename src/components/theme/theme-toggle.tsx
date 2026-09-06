'use client';

import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'fv-theme';

/**
 * Aplica a escolha no documento.
 *
 * "system" nao grava atributo: sem `data-theme` o CSS cai na media query, que
 * e o que faz o tema acompanhar o sistema operacional em tempo real, inclusive
 * quando o usuario troca com a janela ja aberta.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: React.ReactNode }> = [
  { value: 'light', label: 'Claro', icon: <Sun className="size-3.5" strokeWidth={2} /> },
  { value: 'system', label: 'Sistema', icon: <Monitor className="size-3.5" strokeWidth={2} /> },
  { value: 'dark', label: 'Escuro', icon: <Moon className="size-3.5" strokeWidth={2} /> },
];

export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = React.useState<ThemeChoice>('system');
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeChoice | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') setChoice(stored);
    setMounted(true);
  }, []);

  function choose(value: ThemeChoice) {
    setChoice(value);
    applyTheme(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Navegacao anonima pode recusar a escrita: o tema vale para esta sessao.
    }
  }

  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-lg bg-ink-100 p-0.5', className)}
      role="group"
      aria-label="Tema da interface"
    >
      {OPTIONS.map((option) => {
        // Antes de montar nao sabemos a escolha salva; marcar qualquer uma
        // como ativa aqui geraria divergencia entre servidor e cliente.
        const active = mounted && choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            title={option.label}
            aria-label={option.label}
            aria-pressed={active}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition-colors',
              active
                ? 'bg-surface text-ink-900 shadow-[var(--shadow-subtle)]'
                : 'text-ink-400 hover:text-ink-700',
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
