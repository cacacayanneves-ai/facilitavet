import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './login-form';
import { AuthBrandPanel } from '@/components/brand/auth-panel';
import { Logo } from '@/components/brand/logo';

export const metadata = { title: 'Entrar' };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  // Em producao o formulario nunca vem preenchido: o site e publico e as
  // credenciais da demo abririam a conta para qualquer visitante.
  const isDemoEnvironment = process.env.NODE_ENV !== 'production';
  const demoEmail = isDemoEnvironment ? process.env.DEMO_EMAIL ?? 'demo@facilitavet.app' : '';
  const demoPassword = isDemoEnvironment ? process.env.DEMO_PASSWORD ?? 'facilitavet' : '';

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* Coluna do formulario */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo />

          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink-900">
            Entre na sua conta
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Seu roteiro do mês já está pronto esperando por você.
          </p>

          <LoginForm demoEmail={demoEmail} demoPassword={demoPassword} />

          <p className="mt-6 text-center text-sm text-ink-500">
            Ainda não tem conta?{' '}
            <Link href="/cadastro" className="font-medium text-brand-700 hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>

      <AuthBrandPanel />
    </main>
  );
}
