import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap } from '@/lib/data';
import { toLocalDate, weekEnd, weekStart } from '@/lib/domain/dates';
import { computeMetrics } from '@/lib/domain/analytics';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { TaskList } from '@/components/tasks/task-views';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Weekly plan' };

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await getCtx(); const sb = await createClient();
  const { week } = await searchParams;
  const anchor = week ? `${week}T00:00:00` : toLocalDate(new Date(), ctx.tz);
  const ws = weekStart(anchor), we = weekEnd(anchor);
  const prevWeek = weekStart(new Date(new Date(ws).getTime() - 86400000).toISOString());
  const nextWeek = weekStart(new Date(new Date(we).getTime() + 86400000).toISOString());

  const [members, { data: tasks }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('tasks').select('id, title, status, priority, progress, task_type, creator_id, department_id, project_id, original_deadline, current_deadline, estimated_hours, ai_suggested_hours, category_id, created_at, completed_at, approved_at, complexity, projects(name), task_assignees!inner(user_id), task_categories(name)')
      .eq('company_id', ctx.companyId).eq('task_assignees.user_id', ctx.userId).eq('planning_period', 'weekly')
      .gte('period_start', ws).lte('period_start', we).order('current_deadline', { ascending: true, nullsFirst: false }),
  ]);
  const rows = (tasks ?? []) as any[];
  const mm = memberMap(members);

  const metrics = computeMetrics({
    tasks: rows.map((t) => ({ id: t.id, status: t.status, department_id: t.department_id, assignee_ids: [ctx.userId],
      original_deadline: t.original_deadline, current_deadline: t.current_deadline, approved_at: t.approved_at, completed_at: t.completed_at,
      estimated_hours: t.estimated_hours, complexity: t.complexity })),
    unplanned: [], timeLogs: [], blockers: [], from: `${ws}T00:00:00Z`, to: `${we}T23:59:59Z`,
  });

  const isCurrentWeek = ws === weekStart(toLocalDate(new Date(), ctx.tz));

  return (<>
    <PageHeader title="Weekly plan" description={`${fmtDate(`${ws}T00:00:00`, ctx.tz)} – ${fmtDate(`${we}T00:00:00`, ctx.tz)}${isCurrentWeek ? ' (this week)' : ''}`}
      actions={<div className="flex items-center gap-2">
        <Link href={`/planning?week=${prevWeek}`} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>← Prev</Link>
        <Link href={`/planning?week=${nextWeek}`} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>Next →</Link>
        <Link href={`/tasks/new`} className={cn(buttonVariants({ variant: 'primary' }))}><Plus className="size-3.5" />Commit to a task</Link>
      </div>} />
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card><Stat label="Committed" value={metrics.plannedCommitted} /></Card>
      <Card><Stat label="Completed" value={metrics.plannedCompleted} /></Card>
      <Card><Stat label="Completion rate" value={metrics.commitmentCompletionRate !== null ? `${Math.round(metrics.commitmentCompletionRate * 100)}%` : '—'} /></Card>
      <Card><Stat label="On original deadline" value={metrics.originalDeadlineAdherence !== null ? `${Math.round(metrics.originalDeadlineAdherence * 100)}%` : '—'} /></Card>
    </div>
    <Card>
      {rows.length === 0
        ? <EmptyState title="Nothing committed for this week" description="Weekly commitments you make show up here, separate from unplanned work." action={<Link href="/tasks/new" className={cn(buttonVariants({ variant: 'primary' }))}><Plus className="size-3.5" />Commit to a task</Link>} />
        : <TaskList tasks={rows as any} members={mm} tz={ctx.tz} showAssignee={false} />}
    </Card>
  </>);
}
