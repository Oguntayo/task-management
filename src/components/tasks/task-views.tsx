import Link from 'next/link';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { Avatar, Badge, EmptyState, PriorityBadge, Progress, StatusBadge } from '@/components/ui/primitives';
import { fmtDate, isOverdue, type Member, type TaskRow } from '@/lib/data';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, type TaskStatus } from '@/lib/domain/task-state';

function Deadline({ t, tz }: { t: TaskRow; tz: string }) {
  const extended = t.original_deadline && t.current_deadline && t.current_deadline !== t.original_deadline;
  return (<span className={cn('tabular inline-flex items-center gap-1 text-xs', isOverdue(t) ? 'font-medium text-danger' : 'text-muted')}>
    {isOverdue(t) && <AlertTriangle className="size-3" aria-label="Overdue" />}{fmtDate(t.current_deadline, tz)}
    {extended && <span className="text-subtle line-through" title="Original deadline">{fmtDate(t.original_deadline, tz)}</span>}</span>);
}
const Assignees = ({ t, members }: { t: TaskRow; members: Map<string, Member> }) => (
  <span className="flex -space-x-1.5">{t.task_assignees.slice(0, 3).map((a) => <span key={a.user_id} title={members.get(a.user_id)?.name} className="rounded-full ring-2 ring-surface"><Avatar name={members.get(a.user_id)?.name} url={members.get(a.user_id)?.avatar} size={22} /></span>)}</span>);

export function TaskList({ tasks, members, tz, showAssignee }: { tasks: TaskRow[]; members: Map<string, Member>; tz: string; showAssignee?: boolean }) {
  if (!tasks.length) return <EmptyState icon={<CalendarClock className="size-6" />} title="No tasks match" description="Try clearing a filter, or create a task to get started." />;
  return (
    <div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
      <thead className="border-b text-[11px] uppercase tracking-wider text-subtle"><tr><th className="px-4 py-2 font-medium">Task</th><th className="px-2 py-2 font-medium">Status</th><th className="hidden px-2 py-2 font-medium sm:table-cell">Priority</th>
        <th className="hidden w-28 px-2 py-2 font-medium md:table-cell">Progress</th><th className="px-2 py-2 font-medium">Due</th>{showAssignee && <th className="hidden px-2 py-2 font-medium sm:table-cell">Who</th>}</tr></thead>
      <tbody className="divide-y">{tasks.map((t) => (
        <tr key={t.id} className="group hover:bg-surface-2/60">
          <td className="max-w-[22rem] px-4 py-2.5"><Link href={`/tasks/${t.id}`} className="block truncate font-medium after:absolute after:inset-0 group-hover:text-accent relative">{t.title}</Link>
            <span className="flex items-center gap-1.5 text-[11px] text-subtle">{t.projects && <span className="rounded bg-accent-soft px-1 text-accent-soft-fg">{t.projects.name}</span>}{t.task_categories?.name}{t.task_type === 'ad_hoc' && <Badge tone="warn">Added mid-period</Badge>}</span></td>
          <td className="px-2 py-2.5"><StatusBadge status={t.status} /></td>
          <td className="hidden px-2 py-2.5 sm:table-cell"><PriorityBadge priority={t.priority} /></td>
          <td className="hidden px-2 py-2.5 md:table-cell"><div className="flex items-center gap-2"><Progress value={t.progress} className="w-16" /><span className="tabular text-[11px] text-muted">{t.progress}%</span></div></td>
          <td className="px-2 py-2.5"><Deadline t={t} tz={tz} /></td>
          {showAssignee && <td className="hidden px-2 py-2.5 sm:table-cell"><Assignees t={t} members={members} /></td>}
        </tr>))}</tbody></table></div>);
}

const BOARD_COLS: TaskStatus[] = ['pending_approval', 'approved', 'in_progress', 'blocked', 'under_review', 'completed'];
export function TaskBoard({ tasks, members, tz }: { tasks: TaskRow[]; members: Map<string, Member>; tz: string }) {
  return (
    <div className="flex gap-3 overflow-x-auto p-3 pb-4">{BOARD_COLS.map((s) => {
      const col = tasks.filter((t) => t.status === s);
      return (<section key={s} className="w-64 shrink-0" aria-label={STATUS_LABEL[s]}>
        <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted">{STATUS_LABEL[s]}<span className="tabular text-subtle">{col.length}</span></h3>
        <ul className="space-y-2">{col.map((t) => (
          <li key={t.id}><Link href={`/tasks/${t.id}`} className={cn('block rounded-md border bg-surface p-2.5 shadow-sm transition-colors hover:border-border-strong', t.status === 'blocked' && 'border-l-2 border-l-danger')}>
            <p className="text-[13px] font-medium leading-snug">{t.title}</p>
            <div className="mt-2 flex items-center justify-between"><Deadline t={t} tz={tz} /><Assignees t={t} members={members} /></div>
            {t.progress > 0 && t.status !== 'completed' && <Progress value={t.progress} className="mt-2" />}
            {(t.priority === 'urgent' || t.priority === 'high') && <div className="mt-2"><PriorityBadge priority={t.priority} /></div>}</Link></li>))}
          {!col.length && <li className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-subtle">Nothing here</li>}</ul></section>);
    })}</div>);
}

export function TaskCalendar({ tasks, tz, month }: { tasks: TaskRow[]; tz: string; month: string }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), offset = (first.getUTCDay() + 6) % 7;
  const byDay = new Map<number, TaskRow[]>();
  for (const t of tasks) { if (!t.current_deadline) continue; const d = new Date(t.current_deadline);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); if (local.startsWith(month)) { const n = Number(local.slice(8)); byDay.set(n, [...(byDay.get(n) ?? []), t]); } }
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i - offset + 1);
  return (
    <div className="p-3"><div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted">{d}</div>)}
      {cells.map((d, i) => (<div key={i} className={cn('min-h-20 bg-surface p-1', (d < 1 || d > days) && 'bg-surface-2/50')}>
        {d >= 1 && d <= days && <><p className="tabular px-1 text-[11px] text-subtle">{d}</p>
          {(byDay.get(d) ?? []).slice(0, 3).map((t) => <Link key={t.id} href={`/tasks/${t.id}`} className={cn('mt-0.5 block truncate rounded px-1 py-0.5 text-[11px]', isOverdue(t) ? 'bg-danger-soft text-danger' : t.status === 'completed' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent-soft-fg')}>{t.title}</Link>)}
          {(byDay.get(d)?.length ?? 0) > 3 && <p className="px-1 text-[10px] text-subtle">+{byDay.get(d)!.length - 3} more</p>}</>}</div>))}
    </div></div>);
}
