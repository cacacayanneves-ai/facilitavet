'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import {
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  Map as MapIcon,
  Settings,
  Users,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Resumo' },
  { href: '/planejamento', label: 'Planejamento', icon: ClipboardList, hint: 'Planejamento mensal' },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays, hint: 'Visitas por dia' },
  { href: '/mapa', label: 'Mapa', icon: MapIcon, hint: 'Visualização geográfica' },
  { href: '/carteira', label: 'Carteira', icon: Users, hint: 'Clínicas' },
  { href: '/historico', label: 'Histórico', icon: History, hint: 'Visitas realizadas' },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, hint: 'Preferências' },
];

export function Sidebar({ userName, company }: { userName: string; company: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-200 bg-surface lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" className="transition-opacity hover:opacity-80">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                active ? 'bg-brand-50 text-brand-800' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
              )}
            >
              {active && (
                <span className="absolute inset-y-1.5 -left-3 w-1 rounded-r-full bg-brand-600" aria-hidden />
              )}
              <Icon
                className={cn('size-4.5 shrink-0', active ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600')}
                strokeWidth={1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-ink-200 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink-800">{userName}</p>
            {company && <p className="truncate text-[11px] text-ink-400">{company}</p>}
          </div>
        </div>
        <ThemeToggle className="w-full justify-center" />
      </div>
    </aside>
  );
}

/** Navegacao inferior do celular: so o que se usa em campo (secao 55). */
export function MobileNav() {
  const pathname = usePathname();
  const items = NAV.filter((item) =>
    ['/dashboard', '/agenda', '/mapa', '/carteira'].includes(item.href),
  );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-surface/95 backdrop-blur-sm lg:hidden">
      <div className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                active ? 'text-brand-700' : 'text-ink-400',
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2 : 1.75} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
