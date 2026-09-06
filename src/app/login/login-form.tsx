'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';

/**
 * As credenciais de demonstracao so chegam preenchidas fora de producao
 * (ver login/page.tsx): num site publico, um formulario pre-preenchido deixa
 * a conta aberta para qualquer visitante.
 */
export function LoginForm({ demoEmail, demoPassword }: { demoEmail: string; demoPassword: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState(demoEmail);
  const [password, setPassword] = React.useState(demoPassword);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok) {
      router.push('/dashboard');
      router.refresh();
      return;
    }

    const data = await response.json().catch(() => ({ error: 'Falha ao entrar.' }));
    setError(data.error ?? 'E-mail ou senha inválidos.');
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="E-mail">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </Field>

      <Field label="Senha">
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Entrar
      </Button>

      {demoPassword && (
        <p className="rounded-lg bg-ink-100 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
          <span className="font-medium text-ink-700">Conta de demonstração</span> já preenchida —
          ambiente de desenvolvimento.
        </p>
      )}
    </form>
  );
}
