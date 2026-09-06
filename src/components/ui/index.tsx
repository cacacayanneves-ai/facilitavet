'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ==========================================================================
   Componentes base do Facilita Vet.

   Escritos a mao em vez de instalados de uma biblioteca: o produto tem um
   vocabulario visual pequeno e especifico (cards de metrica, badges de
   categoria, linhas de rota), e uma camada generica so adicionaria peso e
   sobrescritas. Cada componente aqui existe porque aparece em pelo menos
   tres telas.
   ========================================================================== */

/* ------------------------------- Card ---------------------------------- */

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-ink-200/70 bg-white shadow-[var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight text-ink-900', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('mt-0.5 text-xs text-ink-500', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 py-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center gap-2 border-t border-ink-200/70 px-5 py-3', className)} {...props} />
  );
}

/* ------------------------------ Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-white shadow-[var(--shadow-subtle)] hover:bg-brand-800 active:bg-brand-900 disabled:bg-ink-300',
  accent:
    'bg-accent-600 text-white shadow-[var(--shadow-subtle)] hover:bg-accent-700 active:brightness-95 disabled:bg-ink-300',
  secondary: 'bg-ink-100 text-ink-800 hover:bg-ink-200 active:bg-ink-300 disabled:text-ink-400',
  outline:
    'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50 hover:border-ink-400 active:bg-ink-100 disabled:text-ink-400',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
  danger: 'bg-danger text-white hover:brightness-95 active:brightness-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9',
};

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
      />
    </svg>
  );
}

/* ------------------------------- Badge --------------------------------- */

type BadgeTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger' | 'info' | 'cat1' | 'cat2' | 'cat3';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-100 text-ink-600 ring-ink-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  positive: 'bg-[var(--color-positive-soft)] text-[color-mix(in_oklch,var(--color-positive),black_25%)] ring-[color-mix(in_oklch,var(--color-positive),white_60%)]',
  warning: 'bg-[var(--color-warning-soft)] text-[color-mix(in_oklch,var(--color-warning),black_35%)] ring-[color-mix(in_oklch,var(--color-warning),white_55%)]',
  danger: 'bg-[var(--color-danger-soft)] text-[color-mix(in_oklch,var(--color-danger),black_15%)] ring-[color-mix(in_oklch,var(--color-danger),white_65%)]',
  info: 'bg-[var(--color-info-soft)] text-[color-mix(in_oklch,var(--color-info),black_25%)] ring-[color-mix(in_oklch,var(--color-info),white_60%)]',
  cat1: 'bg-brand-50 text-brand-800 ring-brand-200',
  cat2: 'bg-[var(--color-info-soft)] text-[color-mix(in_oklch,var(--color-cat2),black_25%)] ring-[color-mix(in_oklch,var(--color-cat2),white_65%)]',
  cat3: 'bg-[color-mix(in_oklch,var(--color-cat3),white_92%)] text-[color-mix(in_oklch,var(--color-cat3),black_25%)] ring-[color-mix(in_oklch,var(--color-cat3),white_70%)]',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const tone = category === 'CAT1' ? 'cat1' : category === 'CAT2' ? 'cat2' : 'cat3';
  const label = category === 'CAT1' ? 'Cat 1' : category === 'CAT2' ? 'Cat 2' : 'Cat 3';
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}

/* ------------------------------- Input --------------------------------- */

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9.5 w-full rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900',
          'placeholder:text-ink-400 transition-colors',
          'hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          'disabled:bg-ink-100 disabled:text-ink-500',
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Campo de senha com alternancia de visibilidade.
 *
 * Digitar senha as cegas em celular e a maior fonte de "senha invalida" que
 * na verdade era erro de digitacao — o olho resolve isso sem afrouxar nada.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'>
>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn(
          'h-9.5 w-full rounded-lg border border-ink-300 bg-white pl-3 pr-10 text-sm text-ink-900',
          'placeholder:text-ink-400 transition-colors',
          'hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          'disabled:bg-ink-100 disabled:text-ink-500',
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        title={visible ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-400 transition-colors hover:text-ink-700"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'h-9.5 w-full appearance-none rounded-lg border border-ink-300 bg-white px-3 pr-8 text-sm text-ink-900',
          'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[position:right_0.5rem_center] bg-no-repeat',
          'transition-colors hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900',
          'placeholder:text-ink-400 transition-colors',
          'hover:border-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('block text-xs font-medium text-ink-700', className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--color-danger)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------ Switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
}) {
  return (
    <label className={cn('flex items-start gap-3', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand-600' : 'bg-ink-300',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-ink-800">{label}</span>}
          {description && <span className="block text-xs text-ink-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

/* ----------------------------- Progress -------------------------------- */

export function Progress({
  value,
  className,
  tone = 'brand',
}: {
  value: number;
  className?: string;
  tone?: 'brand' | 'accent' | 'positive';
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const bar =
    tone === 'accent' ? 'bg-accent-500' : tone === 'positive' ? 'bg-[var(--color-positive)]' : 'bg-brand-600';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink-200', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-700 ease-out', bar)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/* ------------------------------ Dialog --------------------------------- */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/25 backdrop-blur-[2px] animate-[fade_0.2s_ease-out]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-[var(--shadow-float)] sm:rounded-2xl',
          'animate-[rise_0.28s_cubic-bezier(0.16,1,0.3,1)]',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Estados -------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-ink-100 text-ink-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'positive';
  title?: string;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const tones = {
    info: 'bg-[var(--color-info-soft)] border-[color-mix(in_oklch,var(--color-info),white_70%)] text-[color-mix(in_oklch,var(--color-info),black_35%)]',
    warning:
      'bg-[var(--color-warning-soft)] border-[color-mix(in_oklch,var(--color-warning),white_62%)] text-[color-mix(in_oklch,var(--color-warning),black_42%)]',
    danger:
      'bg-[var(--color-danger-soft)] border-[color-mix(in_oklch,var(--color-danger),white_72%)] text-[color-mix(in_oklch,var(--color-danger),black_18%)]',
    positive:
      'bg-[var(--color-positive-soft)] border-[color-mix(in_oklch,var(--color-positive),white_68%)] text-[color-mix(in_oklch,var(--color-positive),black_30%)]',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-xs leading-relaxed', tones[tone], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/* ------------------------------- Tabs ---------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-lg bg-ink-100 p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
            active === tab.id
              ? 'bg-white text-ink-900 shadow-[var(--shadow-subtle)]'
              : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn('ml-1.5 tabular', active === tab.id ? 'text-ink-400' : 'text-ink-400')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Tooltip -------------------------------- */

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
