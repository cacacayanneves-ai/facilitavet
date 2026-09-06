import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { Topbar } from '@/components/layout/topbar';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Importar carteira' };

export default async function ImportPage() {
  await requireUser();

  return (
    <>
      <Topbar
        title="Importar carteira"
        subtitle="XLSX ou CSV"
        actions={
          <Link
            href="/carteira"
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <ChevronLeft className="size-3.5" />
            Carteira
          </Link>
        }
      />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <ImportWizard />
      </main>
    </>
  );
}
