import { requireUser } from '@/lib/auth';
import { MobileNav, Sidebar } from '@/components/layout/sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <Sidebar userName={user.name} company={user.company} />
      <div className="lg:pl-60">
        <div className="pb-20 lg:pb-0">{children}</div>
      </div>
      <MobileNav />
    </div>
  );
}
