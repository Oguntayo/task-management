'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarDays, Columns3, List, Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { Option } from '@/components/forms/unplanned-form';

/** Filters live in the URL so switching List/Board/Calendar keeps them (and links are shareable). */
export function TaskToolbar({ people, departments, projects, showPeopleFilters }: { people: Option[]; departments: Option[]; projects: Option[]; showPeopleFilters: boolean }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams(); const [, start] = useTransition();
  const view = sp.get('view') ?? 'list';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp.toString()); v ? n.set(k, v) : n.delete(k); start(() => router.replace(`${path}?${n.toString()}`)); };
  const views = [['list', List, 'List'], ['board', Columns3, 'Board'], ['calendar', CalendarDays, 'Calendar']] as const;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
      <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="View">{views.map(([v, Icon, label]) => (
        <button key={v} role="tab" aria-selected={view === v} onClick={() => set('view', v)} className={cn('inline-flex h-6 items-center gap-1 rounded px-2 text-xs', view === v ? 'bg-surface-2 font-medium' : 'text-muted hover:text-fg')}><Icon className="size-3" />{label}</button>))}</div>
      <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-subtle" /><Input className="w-40 pl-7" placeholder="Search" defaultValue={sp.get('q') ?? ''} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value)} aria-label="Search tasks" /></div>
      <Select className="w-32" value={sp.get('status') ?? 'open'} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="open">Open</option><option value="all">All</option><option value="draft">Draft</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="under_review">Under review</option><option value="completed">Completed</option><option value="rejected">Rejected</option></Select>
      <Select className="w-28" value={sp.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)} aria-label="Priority"><option value="">Any priority</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
      {projects.length > 0 && <Select className="w-36" value={sp.get('project') ?? ''} onChange={(e) => set('project', e.target.value)} aria-label="Product"><option value="">All products</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>}
      {showPeopleFilters && <>
        <Select className="w-36" value={sp.get('assignee') ?? ''} onChange={(e) => set('assignee', e.target.value)} aria-label="Employee"><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
        <Select className="w-36" value={sp.get('department') ?? ''} onChange={(e) => set('department', e.target.value)} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        <Select className="w-32" value={sp.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)} aria-label="Work type"><option value="">Planned + unplanned</option><option value="planned">Planned only</option><option value="unplanned">Unplanned only</option></Select></>}
      {sp.toString() && <button className="text-xs text-muted hover:text-fg" onClick={() => start(() => router.replace(`${path}?view=${view}`))}>Clear</button>}
    </div>);
}
