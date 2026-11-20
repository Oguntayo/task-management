import Link from 'next/link';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, getTasks, isOverdue, memberMap, TASK_COLS, type TaskRow, UNPLANNED_COLS, type UnplannedRow } from '@/lib/data';
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Stat, StatusBadge, WorkTypeBadge } from '@/components/ui/primitives';
import { buttonVariants } from '@/components/ui/button';
import { dashboardsFor } from '@/lib/domain/permissions';
import { computeMetrics, computeWorkload, type TaskRec } from '@/lib/domain/analytics';
import { toLocalDate, weekEnd, weekStart } from '@/lib/domain/dates';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Home' };
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await getCtx(); const { view: v } = await searchParams;
  const allowed = dashboardsFor(ctx.roles); const view = v && (allowed as string[]).includes(v) ? v : 'employee';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ctx.tz, hour: '2-digit', hour12: false }).format(new Date()));
  return (
    <>
      <PageHeader title={`${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${ctx.fullName.split(' ')[0]}`} description={new Intl.DateTimeFormat('en-GB', { timeZone: ctx.tz, dateStyle: 'full' }).format(new Date())}
        actions={allowed.length > 1 ? <div className="inline-flex rounded-md border p-0.5" role="tablist">{allowed.map((a) => <Link key={a} role="tab" aria-selected={view === a} href={`/dashboard?view=${a}`} className={cn('rounded px-2.5 py-1 text-xs capitalize', view === a ? 'bg-surface-2 font-medium' : 'text-muted hover:text-fg')}>{a === 'pm' ? 'Team' : a === 'admin' ? 'Company' : 'Me'}</Link>)}</div> : undefined} />
      {view === 'admin' ? <AdminView /> : view === 'pm' ? <TeamView /> : <EmployeeView />}
    </>);
}

async function EmployeeView() {
  const ctx = await getCtx(); const sb = await createClient();
  const today = toLocalDate(new Date(), ctx.tz), ws = weekStart(today), we = weekEnd(today);
  const [tasks, { data: unplanned }, { data: projects }, { data: logs }] = await Promise.all([
    getTasks(sb, ctx.companyId, { status: 'all' }, { mineUserId: ctx.userId, limit: 200 }),
    sb.from('unplanned_work_entries').select(UNPLANNED_COLS).eq('company_id', ctx.companyId).eq('user_id', ctx.userId).order('occurred_at', { ascending: false }).limit(5),
    sb.from('project_members').select('projects(id, name, progress, projected_eta, ai_eta, status)').eq('user_id', ctx.userId),
    sb.from('task_activity_logs').select('id, task_id, event, details, created_at, tasks(title)').eq('company_id', ctx.companyId).eq('actor_id', ctx.userId).not('task_id', 'is', null).order('created_at', { ascending: false }).limit(6),
  ]);
  const open = tasks.filter((t) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(t.status));
  const overdue = open.filter(isOverdue), pending = tasks.filter((t) => ['pending_approval', 'submitted'].includes(t.status)), blocked = open.filter((t) => t.status === 'blocked');
  const dueSoon = open.filter((t) => t.current_deadline && toLocalDate(t.current_deadline, ctx.tz) <= toLocalDate(new Date(Date.now() + 86_400_000), ctx.tz)).sort((a, b) => a.current_deadline!.localeCompare(b.current_deadline!));
  const weekCommit = tasks.filter((t) => ['approved', 'in_progress', 'blocked', 'under_review', 'completed'].includes(t.status) && t.current_deadline && toLocalDate(t.current_deadline, ctx.tz) >= ws && toLocalDate(t.current_deadline, ctx.tz) <= we);
  const weekDone = weekCommit.filter((t) => t.status === 'completed');
  const stale = open.filter((t) => t.status === 'in_progress' && (tasks.find((x) => x.id === t.id) && Date.now() - new Date(t.created_at).getTime() > 2 * 86_400_000) && t.progress < 100).slice(0, 3);
  const members = memberMap(await getMembers(sb, ctx.companyId)); void members;
  const myProjects = (projects ?? []).map((p: any) => p.projects).filter(Boolean);
  const mk = (rows: TaskRow[]) => rows.slice(0, 5);
  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
        <Stat label="This week" value={`${weekDone.length}/${weekCommit.length}`} hint="committed tasks done" href="/tasks" />
        <Stat label="In progress" value={open.filter((t) => t.status === 'in_progress').length} href="/tasks?status=in_progress" />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'danger' : undefined} href="/tasks?status=open" />
        <Stat label="Awaiting approval" value={pending.length} href="/tasks?status=pending_approval" />
      </Card>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card><CardHeader title="Today's priorities" description="Due within a day, or already late" action={<Link href="/tasks/new" className={buttonVariants({ size: 'sm' })}>New task</Link>} />
            {dueSoon.length + overdue.filter((o) => !dueSoon.includes(o)).length === 0 ? <EmptyState title="Nothing urgent today" description="Check your active work below, or plan your week." action={<Link href="/planning" className={buttonVariants({ size: 'sm' })}>Open weekly plan</Link>} /> :
              <ul className="divide-y">{[...overdue, ...dueSoon.filter((d) => !overdue.includes(d))].slice(0, 6).map((t) => <TaskLine key={t.id} t={t} tz={ctx.tz} />)}</ul>}</Card>
          <Card><CardHeader title="Active work" action={<Link href="/tasks" className="text-xs text-muted hover:text-fg">All tasks</Link>} />
            {open.length === 0 ? <EmptyState title="No active tasks" description="Approved tasks you are working on appear here." /> : <ul className="divide-y">{mk(open).map((t) => <TaskLine key={t.id} t={t} tz={ctx.tz} />)}</ul>}</Card>
          {stale.length > 0 && <Card className="border-warn/40"><CardHeader title="Tasks that need an update" description="In progress for a while without a recent progress note" />
            <ul className="divide-y">{stale.map((t) => <TaskLine key={t.id} t={t} tz={ctx.tz} />)}</ul></Card>}
          {blocked.length > 0 && <Card><CardHeader title="Blocked" /><ul className="divide-y">{blocked.map((t) => <TaskLine key={t.id} t={t} tz={ctx.tz} />)}</ul></Card>}
        </div>
        <div className="space-y-5">
          {myProjects.length > 0 && <Card><CardHeader title="My products" /><ul className="divide-y">{myProjects.map((p: any) => (
            <li key={p.id}><Link href={`/projects/${p.id}`} className="block px-4 py-2.5 hover:bg-surface-2/60"><div className="flex justify-between text-[13px]"><span className="font-medium">{p.name}</span><span className="tabular text-xs text-muted">{p.progress}%</span></div><Progress value={p.progress} className="mt-1.5" /></Link></li>))}</ul></Card>}
          <Card><CardHeader title="Unplanned work" description="Logged separately, never mixed into commitments" />
            {(unplanned ?? []).length === 0 ? <p className="px-4 py-4 text-xs text-muted">Use “Log unplanned work” in the header whenever something urgent comes up.</p> :
              <ul className="divide-y">{(unplanned as unknown as UnplannedRow[]).map((u) => <li key={u.id}><Link href={`/unplanned/${u.id}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px] hover:bg-surface-2/60"><span className="truncate">{u.title}</span><span className="tabular shrink-0 text-xs text-muted">{u.hours_spent}h</span></Link></li>)}</ul>}</Card>
          <Card><CardHeader title="Recent activity" />
            {(logs ?? []).length === 0 ? <p className="px-4 py-4 text-xs text-muted">Your actions on tasks will appear here.</p> :
              <ul className="divide-y">{(logs as any[]).map((l) => <li key={l.id} className="px-4 py-2 text-xs"><Link href={`/tasks/${l.task_id}`} className="font-medium hover:text-accent">{l.tasks?.title}</Link><p className="text-muted">{l.event.replace(/_/g, ' ')} · {fmtDate(l.created_at, ctx.tz, true)}</p></li>)}</ul>}</Card>
        </div>
      </div>
    </div>);
}

const TaskLine = ({ t, tz }: { t: TaskRow; tz: string }) => (
  <li><Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60"><div className="min-w-0"><p className="truncate text-[13px] font-medium">{t.title}</p>
    <p className={cn('tabular text-[11px]', isOverdue(t) ? 'text-danger' : 'text-subtle')}>{isOverdue(t) ? 'Overdue · ' : 'Due '}{fmtDate(t.current_deadline, tz, true)}{t.projects && ` · ${t.projects.name}`}</p></div>
    <div className="flex shrink-0 items-center gap-2"><span className="tabular text-xs text-muted">{t.progress}%</span><StatusBadge status={t.status} /></div></Link></li>);

async function TeamView() {
  const ctx = await getCtx(); const sb = await createClient();
  const [members, tasks, { data: pendingExt }, { data: unplanned }, { data: blockers }, { data: estimates }] = await Promise.all([
    getMembers(sb, ctx.companyId), getTasks(sb, ctx.companyId, { status: 'all' }, { limit: 400 }),
    sb.from('task_deadline_change_requests').select('id, task_id, requested_by, requested_deadline, tasks(title)').eq('company_id', ctx.companyId).eq('status', 'pending').order('created_at').limit(5),
    sb.from('unplanned_work_entries').select(UNPLANNED_COLS).eq('company_id', ctx.companyId).eq('review_status', 'reported').order('occurred_at', { ascending: false }).limit(5),
    sb.from('task_blockers').select('id, task_id, description, is_external, reported_at, tasks(title)').eq('company_id', ctx.companyId).eq('status', 'open').order('reported_at').limit(5),
    sb.from('ai_task_estimates').select('task_id, verdict, recommended_min_hours, recommended_max_hours, employee_estimate_hours, tasks!inner(title, status)').eq('company_id', ctx.companyId).neq('verdict', 'reasonable').eq('tasks.status', 'pending_approval').order('created_at', { ascending: false }).limit(5),
  ]);
  const mm = memberMap(members);
  const pending = tasks.filter((t) => ['pending_approval', 'submitted'].includes(t.status)), overdue = tasks.filter(isOverdue), blocked = tasks.filter((t) => t.status === 'blocked');
  const upcoming = tasks.filter((t) => ['approved', 'in_progress'].includes(t.status) && t.current_deadline && new Date(t.current_deadline) > new Date()).sort((a, b) => a.current_deadline!.localeCompare(b.current_deadline!)).slice(0, 6);
  const rec: Array<TaskRec & { progress: number }> = tasks.map((t) => ({ ...t, assignee_ids: t.task_assignees.map((a) => a.user_id), approved_at: null, complexity: null, progress: t.progress }));
  const load = computeWorkload({ tasks: rec, userIds: members.map((m) => m.id), capacityHoursPerUser: ctx.settings.working_hours_per_day * 5 }).filter((w) => w.openTasks > 0 || true);
  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
        <Stat label="Pending approval" value={pending.length + (pendingExt?.length ?? 0) + (unplanned?.length ?? 0)} hint="tasks, extensions, unplanned" href="/approvals" />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'danger' : undefined} href="/team?status=open" />
        <Stat label="Blocked" value={blocked.length} href="/blockers" />
        <Stat label="Active" value={tasks.filter((t) => ['approved', 'in_progress'].includes(t.status)).length} href="/team" />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Approval queue" action={<Link href="/approvals" className="text-xs text-muted hover:text-fg">Open</Link>} />
          {pending.length + (pendingExt?.length ?? 0) + (unplanned?.length ?? 0) === 0 ? <EmptyState title="Nothing waiting for you" /> : <ul className="divide-y">
            {pending.slice(0, 4).map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="flex justify-between gap-2 px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="truncate">{t.title}</span><span className="shrink-0 text-xs text-muted">{mm.get(t.creator_id)?.name}</span></Link></li>)}
            {(pendingExt ?? []).map((r: any) => <li key={r.id}><Link href={`/tasks/${r.task_id}`} className="flex justify-between gap-2 px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="truncate">Extension: {r.tasks?.title}</span><Badge tone="info">to {fmtDate(r.requested_deadline, ctx.tz)}</Badge></Link></li>)}
            {(unplanned as unknown as UnplannedRow[] ?? []).map((u) => <li key={u.id}><Link href={`/unplanned/${u.id}`} className="flex justify-between gap-2 px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="truncate">{u.title}</span><WorkTypeBadge unplanned urgent={u.is_urgent} /></Link></li>)}</ul>}</Card>
        <Card><CardHeader title="AI timeline flags" description="Estimates the AI thinks deserve a second look. Advice only." />
          {(estimates ?? []).length === 0 ? <EmptyState title="No flagged estimates" description="Pending tasks with a questionable estimate show up here." /> : <ul className="divide-y">{(estimates as any[]).map((e) => <li key={e.task_id}><Link href={`/tasks/${e.task_id}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><p className="truncate font-medium">{e.tasks.title}</p><p className="text-xs text-muted">Employee {e.employee_estimate_hours}h · AI {e.recommended_min_hours}–{e.recommended_max_hours}h · {String(e.verdict).replace(/_/g, ' ')}</p></Link></li>)}</ul>}</Card>
        <Card><CardHeader title="Team workload" description="Remaining estimated hours vs. a 5-day week" /><ul className="divide-y">{load.map((w) => (
          <li key={w.user_id} className="flex items-center gap-3 px-4 py-2.5"><Avatar name={mm.get(w.user_id)?.name} url={mm.get(w.user_id)?.avatar} size={22} /><span className="w-28 truncate text-[13px]">{mm.get(w.user_id)?.name}</span>
            <div className="flex-1"><Progress value={Math.min(100, (w.utilisation ?? 0) * 100)} /></div><span className="tabular w-24 text-right text-xs text-muted">{w.remainingHours}h · {w.openTasks} tasks</span></li>))}</ul></Card>
        <Card><CardHeader title="Blocked & upcoming" />
          <ul className="divide-y">{(blockers ?? []).map((b: any) => <li key={b.id}><Link href={`/tasks/${b.task_id}`} className="block px-4 py-2 text-[13px] hover:bg-surface-2/60"><p className="truncate font-medium">{b.tasks?.title}</p><p className="truncate text-xs text-muted">{b.is_external ? 'External: ' : ''}{b.description}</p></Link></li>)}
            {upcoming.map((t) => <TaskLine key={t.id} t={t} tz={ctx.tz} />)}
            {!(blockers ?? []).length && !upcoming.length && <li className="px-4 py-6 text-center text-xs text-muted">Nothing blocked or coming up.</li>}</ul></Card>
      </div>
    </div>);
}

async function AdminView() {
  const ctx = await getCtx(); const sb = await createClient();
  const now = new Date(), from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [members, tasks, { data: unplanned }, { data: logs }, { data: blockers }, { data: depts }, { data: projects }] = await Promise.all([
    getMembers(sb, ctx.companyId), getTasks(sb, ctx.companyId, { status: 'all' }, { limit: 1000 }),
    sb.from('unplanned_work_entries').select('id, user_id, occurred_at, hours_spent, is_urgent, work_status, review_status').eq('company_id', ctx.companyId).gte('occurred_at', from),
    sb.from('task_time_logs').select('task_id, user_id, hours, logged_on').eq('company_id', ctx.companyId).gte('logged_on', from.slice(0, 10)),
    sb.from('task_blockers').select('task_id, reported_at, resolved_at, is_external').eq('company_id', ctx.companyId),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId),
    sb.from('projects').select('id, name, status, progress, target_date, ai_eta, projected_eta').eq('company_id', ctx.companyId).in('status', ['planning', 'active', 'on_hold']).order('name'),
  ]);
  const { data: full } = await sb.from('tasks').select('id, status, department_id, original_deadline, current_deadline, approved_at, completed_at, estimated_hours, complexity, task_assignees(user_id)').eq('company_id', ctx.companyId).limit(1000);
  const recs: TaskRec[] = (full ?? []).map((t: any) => ({ ...t, assignee_ids: t.task_assignees.map((a: any) => a.user_id) }));
  const m = computeMetrics({ tasks: recs, unplanned: (unplanned ?? []).map((u: any) => ({ ...u, hours_spent: Number(u.hours_spent) })), timeLogs: (logs ?? []).map((l: any) => ({ ...l, hours: Number(l.hours) })), blockers: blockers ?? [], from, to: now.toISOString() });
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
  const deptRows = (depts ?? []).map((d) => ({ d, t: tasks.filter((t) => t.department_id === d.id) }));
  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-6 lg:divide-y-0">
        <Stat label="People" value={members.length} href="/settings/people" />
        <Stat label="Active tasks" value={tasks.filter((t) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(t.status)).length} href="/team" />
        <Stat label="Completed" value={tasks.filter((t) => t.status === 'completed').length} hint="all time" />
        <Stat label="Overdue" value={tasks.filter(isOverdue).length} tone={tasks.some(isOverdue) ? 'danger' : undefined} href="/team" />
        <Stat label="Pending approvals" value={tasks.filter((t) => t.status === 'pending_approval').length} href="/approvals" />
        <Stat label="Unplanned (30d)" value={`${m.unplannedHours}h`} hint={`${m.urgentInterruptions} urgent`} href="/analytics" />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Products" action={<Link href="/projects" className="text-xs text-muted hover:text-fg">Manage</Link>} />
          {(projects ?? []).length === 0 ? <EmptyState title="No products yet" description="Create a product, assign your team, and the AI will estimate an ETA and track progress from their updates." action={<Link href="/projects/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>Create product</Link>} /> :
            <ul className="divide-y">{(projects ?? []).map((p) => <li key={p.id}><Link href={`/projects/${p.id}`} className="block px-4 py-2.5 hover:bg-surface-2/60"><div className="flex justify-between text-[13px]"><span className="font-medium">{p.name}</span><span className="tabular text-xs text-muted">{p.progress}% · ETA {p.projected_eta ? fmtDate(p.projected_eta, ctx.tz) : p.ai_eta ? `${fmtDate(p.ai_eta, ctx.tz)} (AI)` : '—'}</span></div><Progress value={p.progress} className="mt-1.5" /></Link></li>)}</ul>}</Card>
        <Card><CardHeader title="Delivery, last 30 days" description="Context, not a score. Read alongside unplanned work and blockers." /><dl className="grid grid-cols-2 gap-px bg-border text-[13px]">{[
          ['Commitment completion', pct(m.commitmentCompletionRate)], ['On time vs original deadline', pct(m.originalDeadlineAdherence)], ['On time vs revised deadline', pct(m.revisedDeadlineAdherence)], ['Avg delay when late', m.avgDeliveryDelayDays === null ? '—' : `${m.avgDeliveryDelayDays}d`],
          ['Planned hours logged', `${m.plannedHours}h`], ['Unplanned hours', `${m.unplannedHours}h`], ['Blocked (external)', `${m.blockedHours}h (${m.externalBlockedHours}h)`], ['Extended tasks', String(m.extendedTasks)]].map(([k, v]) => <div key={k} className="bg-surface px-4 py-2.5"><dt className="text-xs text-muted">{k}</dt><dd className="tabular mt-0.5 text-base font-semibold">{v}</dd></div>)}</dl></Card>
        <Card className="lg:col-span-2"><CardHeader title="Departments" action={<Link href="/analytics" className="text-xs text-muted hover:text-fg">Full analytics</Link>} />
          <table className="w-full text-left text-[13px]"><thead className="border-b text-[11px] uppercase tracking-wider text-subtle"><tr><th className="px-4 py-2 font-medium">Department</th><th className="px-2 py-2 font-medium">Active</th><th className="px-2 py-2 font-medium">Completed</th><th className="px-2 py-2 font-medium">Overdue</th><th className="px-2 py-2 font-medium">People</th></tr></thead>
            <tbody className="divide-y">{deptRows.map(({ d, t }) => <tr key={d.id}><td className="px-4 py-2 font-medium">{d.name}</td><td className="tabular px-2">{t.filter((x) => ['approved', 'in_progress', 'blocked', 'under_review'].includes(x.status)).length}</td><td className="tabular px-2">{t.filter((x) => x.status === 'completed').length}</td><td className="tabular px-2">{t.filter(isOverdue).length}</td><td className="tabular px-2">{members.filter((x) => x.departmentId === d.id).length}</td></tr>)}</tbody></table></Card>
      </div>
    </div>);
}
void TASK_COLS;
