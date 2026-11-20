'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BarChart3, CalendarDays, CheckCircle2, ClipboardList, FileText, FolderKanban, Home, ListChecks, Menu, OctagonAlert, PanelLeftClose, PanelLeftOpen, Settings, UserCog, Users, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/lib/domain/permissions';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home, 'list-checks': ListChecks, zap: Zap, 'calendar-days': CalendarDays, 'file-text': FileText, 'check-circle': CheckCircle2, users: Users,
  'octagon-alert': OctagonAlert, 'clipboard-list': ClipboardList, 'bar-chart': BarChart3, 'user-cog': UserCog, settings: Settings, folder: FolderKanban,
};
const SECTIONS: Array<[NavItem['section'], string]> = [['work', 'Work'], ['manage', 'Manage'], ['company', 'Company']];

function Links({ items, collapsed, badges, onNavigate }: { items: NavItem[]; collapsed: boolean; badges: Record<string, number>; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
      {SECTIONS.map(([key, label]) => {
        const list = items.filter((i) => i.section === key); if (!list.length) return null;
        return (<div key={key}>{!collapsed && <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</p>}
          <ul className="space-y-0.5">{list.map((i) => {
            const Icon = ICONS[i.icon] ?? Home;
            const active = path === i.href || (i.href !== '/dashboard' && path.startsWith(i.href + '/')) || (i.href === '/tasks' && path.startsWith('/tasks'));
            return (<li key={i.href}><Link href={i.href} onClick={onNavigate} title={collapsed ? i.label : undefined} aria-current={active ? 'page' : undefined}
              className={cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors', active ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg', collapsed && 'justify-center')}>
              <Icon className="size-4 shrink-0" />{!collapsed && <span className="flex-1 truncate">{i.label}</span>}
              {!collapsed && badges[i.href] > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-[10px] font-medium text-accent-fg">{badges[i.href]}</span>}</Link></li>);
          })}</ul></div>);
      })}
    </nav>);
}

export function Sidebar({ items, companyName, badges }: { items: NavItem[]; companyName: string; badges: Record<string, number> }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { try { setCollapsed(localStorage.getItem('wl-sidebar') === '1'); } catch { /* ignore */ } }, []);
  useEffect(() => setOpen(false), [path]);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('wl-sidebar', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  return (
    <>
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-surface transition-[width] md:flex', collapsed ? 'w-14' : 'w-56')}>
        <div className={cn('flex h-12 items-center border-b px-3', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <span className="truncate text-[13px] font-semibold tracking-tight">{companyName}</span>}
          <button onClick={toggle} className="rounded p-1 text-muted hover:bg-surface-2" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button>
        </div>
        <Links items={items} collapsed={collapsed} badges={badges} />
      </aside>
      {/* mobile: top bar button opens a drawer; primary actions live in a bottom bar (see MobileBar) */}
      <button className="fixed left-3 top-3 z-30 rounded-md border bg-surface p-1.5 shadow-sm md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-4" /></button>
      {open && (<div className="fixed inset-0 z-50 md:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
        <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-md"><div className="flex h-12 items-center justify-between border-b px-3"><span className="text-[13px] font-semibold">{companyName}</span>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-surface-2"><X className="size-4" /></button></div>
          <Links items={items} collapsed={false} badges={badges} onNavigate={() => setOpen(false)} /></div></div>)}
    </>);
}
