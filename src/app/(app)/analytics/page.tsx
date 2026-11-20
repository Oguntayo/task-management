import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/domain/permissions';
import { computeMetrics, computeWorkload } from '@/lib/domain/analytics';
import { getMembers, memberMap } from '@/lib/data';
import { toLocalDate, weekStart, workingDays } from '@/lib/domain/dates';
import { Card, PageHeader, Progress, Select, Stat } from '@/components/ui/primitives';

export const metadata = { title: 'Analytics' };

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; department?: string }> }) {
  const ctx = await getCtx();
  if (!can(ctx.roles, 'analytics.company')) redirect('/dashboard');
  const sb = await createClient();
  const today = toLocalDate(new Date(), ctx.tz);
  const sp = await searchParams;
  const from = sp.from ?? weekStart(today);
  const to = sp.to ?? today;
  const department = sp.department ?? '';

  const [members, { data: deps }, { data: tasks }, { data: unplanned }, { data: timeLogs }, { data: blockers }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId).order('name'),
    sb.from('tasks').select('id, status, department_id, original_deadline, current_deadline, approved_at, completed_at, estimated_hours, complexity, progress, task_assignees(user_id)').eq('company_id', ctx.companyId),
    sb.from('unplanned_work_entries').select('id, user_id, occurred_at, hours_spent, is_urgent, work_status, review_status').eq('company_id', ctx.companyId).gte('occurred_at', `${from}T00:00:00Z`).lte('occurred_at', `${to}T23:59:59Z`),
    sb.from('task_time_logs').select('task_id, user_id, hours, logged_on').eq('company_id', ctx.companyId).gte('logged_on', from).lte('logged_on', to),
    sb.from('task_blockers').select('task_id, reported_at, resolved_at, is_external').eq('company_id', ctx.companyId),
  ]);
  const mm = memberMap(members);
  let allTasks = (tasks ?? []).map((t: any) => ({ ...t, assignee_ids: (t.task_assignees ?? []).map((a: any) => a.user_id) }));
  if (department) allTasks = allTasks.filter((t) => t.department_id === department);

  const metrics = computeMetrics({ tasks: allTasks, unplanned: unplanned ?? [], timeLogs: timeLogs ?? [], blockers: blockers ?? [], from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` });
  const horizonDays = Math.max(1, workingDays(today, to, ctx.settings.working_days) || 5);
  const workload = computeWorkload({ tasks: allTasks, userIds: members.map((m) => m.id), capacityHoursPerUser: horizonDays * ctx.settings.working_hours_per_day })
    .filter((w) => w.openTasks > 0).sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0));

  return (<>
    <PageHeader title="Analytics" description="Context, not judgement: these numbers describe what happened, not who's to blame." />
    <form className="mb-5 flex flex-wrap items-end gap-3 text-xs" action="/analytics" method="get">
      <label className="block">From<input type="date" name="from" defaultValue={from} className="mt-1 block h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px]" /></label>
      <label className="block">To<input type="date" name="to" defaultValue={to} className="mt-1 block h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px]" /></label>
      <label className="block">Department<Select name="department" defaultValue={department} className="mt-1 w-40"><option value="">All</option>{(deps ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></label>
      <button type="submit" className="h-8 rounded-md border border-border-strong bg-surface px-3 text-[13px] hover:bg-surface-2">Apply</button>
    </form>

    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card><Stat label="Committed" value={metrics.plannedCommitted} /></Card>
      <Card><Stat label="Completed" value={metrics.plannedCompleted} /></Card>
      <Card><Stat label="Commitment completion" value={metrics.commitmentCompletionRate !== null ? `${Math.round(metrics.commitmentCompletionRate * 100)}%` : '—'} /></Card>
      <Card><Stat label="On original deadline" value={metrics.originalDeadlineAdherence !== null ? `${Math.round(metrics.originalDeadlineAdherence * 100)}%` : '—'} /></Card>
      <Card><Stat label="On revised deadline" value={metrics.revisedDeadlineAdherence !== null ? `${Math.round(metrics.revisedDeadlineAdherence * 100)}%` : '—'} /></Card>
      <Card><Stat label="Extended deadlines" value={metrics.extendedTasks} hint={metrics.lateTasksWithExternalBlocker ? `${metrics.lateTasksWithExternalBlocker} late tasks had an external blocker` : undefined} /></Card>
      <Card><Stat label="Avg delay (late tasks)" value={metrics.avgDeliveryDelayDays !== null ? `${metrics.avgDeliveryDelayDays}d` : '—'} /></Card>
      <Card><Stat label="Unplanned hours" value={metrics.unplannedHours} hint={`${metrics.unplannedEntries} entries, ${metrics.urgentInterruptions} urgent`} /></Card>
      <Card><Stat label="Planned hours logged" value={metrics.plannedHours} /></Card>
      <Card><Stat label="Blocked hours" value={metrics.blockedHours} hint={`${metrics.externalBlockedHours}h external`} /></Card>
    </div>

    <Card>
      <div className="border-b px-4 py-3"><h2 className="text-[13px] font-semibold">Workload</h2><p className="text-xs text-muted">Open work versus capacity to {to}. Over 100% means more is committed than can realistically be delivered in the window.</p></div>
      {!workload.length ? <p className="px-4 py-6 text-center text-xs text-muted">No open tasks.</p> : (
        <div className="divide-y">{workload.map((w) => (
          <div key={w.user_id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-32 shrink-0 truncate text-[13px]">{mm.get(w.user_id)?.name ?? 'Unknown'}</span>
            <Progress value={Math.min(100, (w.utilisation ?? 0) * 100)} className="flex-1" />
            <span className="w-28 shrink-0 text-right text-[11px] tabular text-subtle">{w.openTasks} open · {w.remainingHours}h left</span>
            <span className="w-14 shrink-0 text-right text-[12px] font-medium tabular">{w.utilisation !== null ? `${Math.round(w.utilisation * 100)}%` : '—'}</span>
          </div>))}</div>)}
    </Card>
  </>);
}
