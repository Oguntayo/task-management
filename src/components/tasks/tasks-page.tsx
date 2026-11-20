import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, getTasks, memberMap, UNPLANNED_COLS, type TaskFilters, type UnplannedRow } from '@/lib/data';
import { Badge, Card, EmptyState, PageHeader, WorkTypeBadge } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { TaskBoard, TaskCalendar, TaskList } from '@/components/tasks/task-views';
import { TaskToolbar } from '@/components/tasks/task-toolbar';
import { toLocalDate } from '@/lib/domain/dates';
import { cn } from '@/lib/utils';

export type TasksSearch = TaskFilters & { view?: string; month?: string };
export async function TasksPage({ scope, sp }: { scope: 'mine' | 'team'; sp: TasksSearch }) {
  const ctx = await getCtx(); const sb = await createClient();
  const f: TaskFilters = { ...sp, status: sp.status ?? 'open' };
  const kind = scope === 'team' ? sp.kind ?? '' : '';
  const [members, tasks, { data: deps }, { data: projs }, unplanned] = await Promise.all([
    getMembers(sb, ctx.companyId),
    kind === 'unplanned' ? Promise.resolve([]) : getTasks(sb, ctx.companyId, f, scope === 'mine' ? { mineUserId: ctx.userId } : {}),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId).order('name'),
    sb.from('projects').select('id, name').eq('company_id', ctx.companyId).order('name'),
    kind === 'planned' ? Promise.resolve([] as UnplannedRow[]) : (async () => {
      let q = sb.from('unplanned_work_entries').select(UNPLANNED_COLS).eq('company_id', ctx.companyId).order('occurred_at', { ascending: false }).limit(50);
      if (scope === 'mine') q = q.eq('user_id', ctx.userId);
      if (sp.assignee) q = q.eq('user_id', sp.assignee);
      if (sp.project) q = q.eq('project_id', sp.project);
      if (sp.priority) q = q.eq('priority', sp.priority);
      const { data } = await q; return (data ?? []) as unknown as UnplannedRow[]; })(),
  ]);
  const mm = memberMap(members), view = sp.view ?? 'list', month = sp.month ?? toLocalDate(new Date(), ctx.tz).slice(0, 7);
  return (
    <>
      <PageHeader title={scope === 'mine' ? 'My tasks' : 'Team tasks'} description={scope === 'mine' ? 'Your commitments, in one place. Completed work stays in your history.' : 'Everything the team has committed to, including unplanned work.'}
        actions={<Link href="/tasks/new" className={cn(buttonVariants({ variant: 'primary' }))}><Plus className="size-3.5" />New task</Link>} />
      <Card>
        <TaskToolbar people={members.map((m) => ({ id: m.id, label: m.name }))} departments={(deps ?? []).map((d) => ({ id: d.id, label: d.name }))} projects={(projs ?? []).map((p) => ({ id: p.id, label: p.name }))} showPeopleFilters={scope === 'team'} />
        {kind !== 'unplanned' && (view === 'board' ? <TaskBoard tasks={tasks} members={mm} tz={ctx.tz} /> : view === 'calendar' ? <TaskCalendar tasks={tasks} tz={ctx.tz} month={month} /> : <TaskList tasks={tasks} members={mm} tz={ctx.tz} showAssignee={scope === 'team'} />)}
      </Card>
      {kind !== 'planned' && (
        <section className="mt-6"><h2 className="mb-2 text-[13px] font-semibold">Unplanned work</h2>
          <Card>{unplanned.length === 0 ? <EmptyState title="No unplanned work recorded" description="Urgent interruptions you log appear here, separate from planned tasks." /> :
            <ul className="divide-y">{unplanned.map((u) => (
              <li key={u.id}><Link href={`/unplanned/${u.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                <div className="min-w-0"><p className="truncate text-[13px] font-medium">{u.title}</p><p className="text-[11px] text-subtle">{mm.get(u.user_id)?.name} · {fmtDate(u.occurred_at, ctx.tz, true)}{u.projects && ` · ${u.projects.name}`}</p></div>
                <div className="flex shrink-0 items-center gap-2"><span className="tabular text-xs text-muted">{u.hours_spent}h</span><WorkTypeBadge unplanned urgent={u.is_urgent} /><Badge tone={u.review_status === 'approved' ? 'ok' : u.review_status === 'rejected' ? 'danger' : 'neutral'}>{u.review_status.replace(/_/g, ' ')}</Badge></div></Link></li>))}</ul>}</Card></section>)}
    </>);
}
