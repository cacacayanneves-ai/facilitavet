'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    // Sem isso, um erro anterior fica na tela quando a validacao nativa do
    // navegador barra o envio — o usuario le uma mensagem que ja nao vale.
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError('A confirmação não confere com a senha.');
      return;
    }

    setLoading(true);
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        password: form.password,
        company: form.company || undefined,
        phone: form.phone || undefined,
      }),
    });

    if (response.ok) {
      router.push('/dashboard');
      router.refresh();
      return;
    }

    const data = await response.json().catch(() => ({ error: 'Falha ao criar a conta.' }));
    setError(data.error ?? 'Não foi possível criar a conta.');
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Nome">
        <Input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          autoComplete="name"
          required
        />
      </Field>

      <Field label="E-mail">
        <Input
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          autoComplete="email"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Empresa" hint="Opcional.">
          <Input
            value={form.company}
            onChange={(e) => update('company', e.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Field label="Telefone" hint="Opcional.">
          <Input
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            autoComplete="tel"
          />
        </Field>
      </div>

      <Field label="Senha" hint="Mínimo de 8 caracteres.">
        <PasswordInput
          value={form.password}
          onChange={(e) => update('password', e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>

      <Field label="Confirmar senha">
        <PasswordInput
          value={form.confirmPassword}
          onChange={(e) => update('confirmPassword', e.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>

      <Button type="submit" size="lg" loading={loading} className="w-full">
        Criar conta
      </Button>
    </form>
  );
}
