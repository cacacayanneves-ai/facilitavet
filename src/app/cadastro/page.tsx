import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SignupForm } from './signup-form';
import { AuthBrandPanel } from '@/components/brand/auth-panel';
import { Logo } from '@/components/brand/logo';

export const metadata = { title: 'Criar conta' };

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Logo />

          <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink-900">
            Criar sua conta
          </h1>
          <p className="mt-1.5 text-sm text-ink-500">
            Leva um minuto. Depois é só importar sua carteira e gerar o primeiro roteiro.
          </p>

          <SignupForm />

          <p className="mt-6 text-center text-sm text-ink-500">
            Já tem conta?{' '}
            <Link href="/login" className="font-medium text-brand-700 hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>

      <AuthBrandPanel />
    </main>
  );
}
