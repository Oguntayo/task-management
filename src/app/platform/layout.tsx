import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/auth/context';
import { ThemeToggle } from '@/components/shell/user-menu';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const sb = await createClient();
  const { data } = await sb.from('profiles').select('is_super_admin, full_name').eq('id', user.id).single();
  if (!data?.is_super_admin) redirect('/dashboard');
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-[13px] font-semibold tracking-tight">Workline <span className="font-normal text-subtle">· Platform</span></p>
        <div className="flex items-center gap-3"><span className="text-xs text-muted">{data.full_name}</span><ThemeToggle /></div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-6">{children}</main>
    </div>);
}
