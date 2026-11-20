'use client';
import { useTheme } from 'next-themes';
import { LogOut, Moon, Sun } from 'lucide-react';
import { Avatar } from '@/components/ui/primitives';
import { logout } from '@/actions/auth';
import { switchCompany } from '@/actions/company';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return <button onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className="rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label="Toggle theme"><Sun className="hidden size-4 dark:block" /><Moon className="size-4 dark:hidden" /></button>;
}

export function UserMenu({ name, email, avatarUrl, companies, activeId, roles }: { name: string; email: string; avatarUrl: string | null; companies: Array<{ id: string; name: string }>; activeId: string; roles: string }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center rounded-full outline-offset-2 [&::-webkit-details-marker]:hidden" aria-label="Account menu"><Avatar name={name} url={avatarUrl} size={28} /></summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-lg border bg-surface p-1 shadow-md">
        <div className="px-3 py-2"><p className="truncate text-[13px] font-medium">{name}</p><p className="truncate text-xs text-muted">{email}</p><p className="mt-0.5 text-[11px] text-subtle">{roles}</p></div>
        {companies.length > 1 && (<div className="border-t py-1"><p className="px-3 py-1 text-[11px] uppercase tracking-wider text-subtle">Workspaces</p>
          {companies.map((c) => (<form key={c.id} action={switchCompany.bind(null, c.id)}><button className="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-[13px] hover:bg-surface-2">{c.name}{c.id === activeId && <span className="text-accent">●</span>}</button></form>))}</div>)}
        <form action={logout} className="border-t pt-1"><button className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2"><LogOut className="size-3.5" />Sign out</button></form>
      </div>
    </details>);
}
