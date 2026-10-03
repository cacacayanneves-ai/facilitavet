/**
 * Coluna de marca das telas de acesso (login e cadastro).
 *
 * Vive separada porque as duas telas compartilham exatamente a mesma
 * apresentacao — mudar o discurso num lugar e esquecer do outro seria a
 * falha mais provavel se isso fosse copiado.
 */
export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[var(--color-brand-panel)] lg:block">
      <div className="absolute inset-0 opacity-[0.14]">
        <svg className="size-full" viewBox="0 0 600 700" fill="none" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0v48" fill="none" stroke="white" strokeWidth="0.7" />
            </pattern>
          </defs>
          <rect width="600" height="700" fill="url(#grid)" />
          <path
            d="M90 560 L160 470 L250 500 L330 380 L300 270 L390 200 L500 240"
            stroke="white"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[
            [90, 560], [160, 470], [250, 500], [330, 380], [300, 270], [390, 200], [500, 240],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="11" fill="white" />
          ))}
        </svg>
      </div>

      <div className="relative flex h-full flex-col justify-end p-14">
        <blockquote className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Você cuida das visitas.
            <br />
            <span className="text-[var(--color-brand-panel-soft)]">A gente facilita o caminho.</span>
          </p>
          <p className="mt-6 text-sm leading-relaxed text-[var(--color-brand-panel-muted)]">
            O Facilita Vet analisa sua carteira, respeita as regras de categoria, distribui as
            visitas pelos dias úteis e monta rotas que concentram cada dia numa região, em vez de
            atravessar a cidade cinco vezes.
          </p>
        </blockquote>

        <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
          {[
            { value: 'Cat 1 · 2 · 3', label: 'Ciclo comercial configurável' },
            { value: 'Rotas por região', label: 'Clustering + otimização' },
            { value: '08:00', label: 'Roteiro no WhatsApp' },
          ].map((item) => (
            <div key={item.label}>
              <dt className="text-sm font-semibold text-white">{item.value}</dt>
              <dd className="mt-0.5 text-[11px] leading-snug text-[var(--color-brand-panel-muted)]">{item.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
