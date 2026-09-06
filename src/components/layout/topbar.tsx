'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { LogOut, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export function Topbar({
  title,
  subtitle,
  actions,
  estimated,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Avisa que os numeros da tela sao estimativas, nao medicoes reais. */
  estimated?: boolean;
}) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-ink-200 bg-ink-50/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="lg:hidden">
          <Logo compact />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          {estimated && (
            <span
              className={cn(
                'hidden items-center gap-1.5 rounded-md bg-[var(--color-warning-soft)] px-2 py-1 text-[11px] font-medium sm:inline-flex',
                'text-[color-mix(in_oklch,var(--color-warning),black_42%)]',
              )}
              title="Sem Google Routes API configurada, distancias e tempos sao estimativas geometricas calibradas."
            >
              <Sparkles className="size-3" />
              Estimativa
            </span>
          )}
          {actions}
          <Button variant="ghost" size="icon" onClick={logout} loading={loggingOut} title="Sair">
            {!loggingOut && <LogOut className="size-4" strokeWidth={1.75} />}
          </Button>
        </div>
      </div>
    </header>
  );
}
