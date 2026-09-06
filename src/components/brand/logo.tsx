import { cn } from '@/lib/utils';

/**
 * Marca do Facilita Vet.
 *
 * O simbolo combina os tres elementos do produto: um PIN de localizacao, uma
 * ROTA que o atravessa e, dentro do pin, a silhueta de uma pata reduzida a
 * quatro pontos — a referencia veterinaria aparece como detalhe geometrico,
 * nao como desenho. Isso mantem o tom B2B: um gestor comercial precisa poder
 * abrir isso numa reuniao.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="fv-mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-brand-500)" />
          <stop offset="1" stopColor="var(--color-brand-800)" />
        </linearGradient>
      </defs>

      {/* Rota: a linha que "facilita o caminho" */}
      <path
        d="M3 26.5c3.6 0 4.2-4.4 7.8-4.4"
        stroke="var(--color-accent-500)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="0.1 4"
      />
      <path
        d="M21.5 22.1c3.6 0 4.3 4.4 7.5 4.4"
        stroke="var(--color-accent-500)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="0.1 4"
      />

      {/* Pin */}
      <path
        d="M16 2.5c-5.1 0-9.2 4.1-9.2 9.2 0 6.4 8.1 15 8.4 15.4a1 1 0 0 0 1.5 0c.3-.4 8.4-9 8.4-15.4 0-5.1-4.1-9.2-9.1-9.2Z"
        fill="url(#fv-mark)"
      />

      {/* Pata: quatro dedos + coxim, em negativo */}
      <g fill="white" opacity="0.95">
        <ellipse cx="12.5" cy="9.6" rx="1.35" ry="1.75" />
        <ellipse cx="16" cy="8.6" rx="1.35" ry="1.85" />
        <ellipse cx="19.5" cy="9.6" rx="1.35" ry="1.75" />
        <path d="M16 12.1c2.6 0 4.3 1.7 4.3 3.5s-1.9 2.4-4.3 2.4-4.3-.6-4.3-2.4 1.7-3.5 4.3-3.5Z" />
      </g>
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-ink-900">
            Facilita<span className="text-brand-600">Vet</span>
          </span>
          <span className="mt-0.5 text-[10px] font-medium tracking-wide text-ink-400">
            PLANEJAMENTO DE VISITAS
          </span>
        </span>
      )}
    </span>
  );
}
