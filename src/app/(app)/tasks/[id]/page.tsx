import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap, isOverdue, type TaskRow } from '@/lib/data';
import { Avatar, Badge, Card, CardHeader, EmptyState, PriorityBadge, Progress, StatusBadge, WorkTypeBadge } from '@/components/ui/primitives';
import { ApprovalPanel, AttachmentAdder, BlockerButton, CommentForm, ExtensionButton, ExtensionDecision, ProgressForm, ResolveBlocker, StatusActions } from '@/components/tasks/task-panels';
import { userTransitions, type TaskStatus } from '@/lib/domain/task-state';

const EVENT_LABEL: Record<string, string> = { created: 'Task created', status_changed: 'Status changed', progress_updated: 'Progress updated', deadline_changed: 'Deadline changed', fields_updated: 'Details edited',
  assignee_added: 'Assignee added', assignee_removed: 'Assignee removed', blocker_reported: 'Blocker reported', blocker_resolved: 'Blocker resolved', deadline_extension_requested: 'Extension requested',
  deadline_request_approved: 'Extension approved', deadline_request_rejected: 'Extension rejected', deadline_request_clarification_requested: 'Extension: clarification asked', deadline_clarification_provided: 'Extension: clarification given',
  deadline_request_withdrawn: 'Extension withdrawn', approval_approved: 'Approved', approval_rejected: 'Rejected', approval_clarification_requested: 'Clarification requested', approval_revision_requested: 'Revised timeline requested', approval_priority_change_suggested: 'Priority change suggested' };
const describe = (e: { event: string; details: any }, tz: string) => {
  const d = e.details ?? {};
  if (e.event === 'status_changed') return `${String(d.from).replace(/_/g, ' ')} → ${String(d.to).replace(/_/g, ' ')}`;
  if (e.event === 'progress_updated') return `${d.from}% → ${d.to}%`;
  if (e.event === 'deadline_changed') return `${fmtDate(d.from, tz, true)} → ${fmtDate(d.to, tz, true)} (original ${fmtDate(d.original_deadline, tz, true)})`;
  if (e.event.startsWith('approval_') || e.event.startsWith('deadline_request_')) return d.note ?? '';
  if (e.event === 'deadline_extension_requested') return d.reason ?? '';
  if (e.event === 'fields_updated') return Object.keys(d).join(', ');
  return '';
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getCtx(); const sb = await createClient();
  const { data: t } = await sb.from('tasks').select('*, task_categories(name), projects(id, name), task_assignees(user_id)').eq('id', id).eq('company_id', ctx.companyId).maybeSingle();
  if (!t) notFound();
  const [members, { data: approvals }, { data: logs }, { data: comments }, { data: atts }, { data: blockers }, { data: reqs }, { data: est }, { data: recs }, { data: time }, { data: deps }, { data: departments }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('task_approvals').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    sb.from('task_activity_logs').select('id, actor_id, event, details, created_at').eq('task_id', id).order('created_at', { ascending: false }).limit(100),
    sb.from('task_comments').select('id, author_id, body, created_at').eq('task_id', id).order('created_at'),
    sb.from('task_attachments').select('id, cloudinary_url, original_filename, resource_type, uploaded_by').eq('task_id', id),
    sb.from('task_blockers').select('*').eq('task_id', id).order('reported_at', { ascending: false }),
    sb.from('task_deadline_change_requests').select('*').eq('task_id', id).order('created_at', { ascending: false }),
    sb.from('ai_task_estimates').select('*').eq('task_id', id).order('created_at', { ascending: false }).limit(1),
    sb.from('ai_recommendations').select('*').eq('task_id', id).eq('kind', 'deadline_extension').order('created_at', { ascending: false }),
    sb.from('task_time_logs').select('hours').eq('task_id', id),
    sb.from('task_dependencies').select('depends_on_task_id, tasks!task_dependencies_depends_on_task_id_fkey(title, status)').eq('task_id', id),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId),
  ]);
  const mm = memberMap(members); const who = (u: string | null) => (u && mm.get(u)?.name) || 'System';
  const assigneeIds: string[] = t.task_assignees.map((a: any) => a.user_id);
  const isAssignee = assigneeIds.includes(ctx.userId), isCreator = t.creator_id === ctx.userId, mine = isAssignee || isCreator;
  const hoursLogged = (time ?? []).reduce((s, l) => s + Number(l.hours), 0);
  const openBlockers = (blockers ?? []).filter((b) => b.status === 'open');
  const status = t.status as TaskStatus;
  const next = mine || ctx.isLeader ? userTransitions(status, { isManager: ctx.isManager, isLeader: ctx.isLeader, isCreator, hasOpenBlockers: openBlockers.length > 0, requireCompletionReview: !!ctx.settings.require_completion_review }) : [];
  const canDecideTask = ctx.isManager && ['submitted', 'pending_approval'].includes(status) && !mine;
  const active = ['approved', 'in_progress', 'blocked', 'under_review'].includes(status);
  const lastReturn = status === 'draft' ? (approvals ?? []).find((a) => ['clarification_requested', 'revision_requested'].includes(a.decision)) : null;
  const e = est?.[0]; const extended = t.original_deadline && t.current_deadline && t.current_deadline !== t.original_deadline;
  const row = t as unknown as TaskRow;
  const recFor = (rid: string) => (recs ?? []).find((r) => r.deadline_request_id === rid);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs text-muted"><Link href="/tasks" className="hover:text-fg">Tasks</Link>/ {t.projects ? <Link href={`/projects/${t.projects.id}`} className="text-accent hover:underline">{t.projects.name}</Link> : 'No product'}</p>
          <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={status} /><PriorityBadge priority={t.priority} /><WorkTypeBadge />{isOverdue(row) && <Badge tone="danger"><AlertTriangle className="size-3" />Overdue</Badge>}
            {t.task_categories?.name && <Badge>{t.task_categories.name}</Badge>}</div>
        </div>
        {lastReturn && <Card className="border-warn/40 bg-warn-soft p-4 text-[13px]"><p className="font-medium text-warn">{who(lastReturn.decided_by)} returned this task</p><p className="mt-1">{lastReturn.note}</p><p className="mt-2 text-xs text-muted">Update the task, then submit it again.</p></Card>}
        {(mine || ctx.isLeader) && next.length + (status === 'draft' ? 1 : 0) > 0 && <StatusActions taskId={id} options={next} isDraft={status === 'draft' && mine} />}
        <Card><CardHeader title="Description" /><div className="space-y-3 px-4 py-3 text-[13px]"><p className="whitespace-pre-wrap">{t.description}</p>
          {t.expected_deliverable && <p><span className="text-muted">Expected deliverable: </span>{t.expected_deliverable}</p>}
          {(deps ?? []).length > 0 && <p><span className="text-muted">Depends on: </span>{(deps as any[]).map((d) => d.tasks?.title).join(', ')}</p>}</div></Card>

        {canDecideTask && <Card className="border-accent/40"><CardHeader title="Decision needed" description="Approving makes this an official commitment and locks the deadline." /><div className="space-y-3 px-4 py-3">
          {e && <AiEstimate e={e} />}<ApprovalPanel taskId={id} /></div></Card>}
        {!canDecideTask && e && <Card><CardHeader title="AI timeline check" description="Advice only. The PM decides." /><div className="px-4 py-3"><AiEstimate e={e} /></div></Card>}

        {active && mine && <Card><CardHeader title="Update progress" description={`${hoursLogged}h logged so far${t.estimated_hours ? ` of ${t.estimated_hours}h estimated` : ''}`} /><div className="px-4 py-3"><ProgressForm taskId={id} progress={t.progress} hasProject={!!t.project_id} /></div></Card>}

        <Card><CardHeader title="Deadline extensions" description="Original deadline is permanent. The current deadline moves only when a request is approved." /><div className="divide-y">
          {(reqs ?? []).length === 0 && <p className="px-4 py-4 text-xs text-muted">No extension requests.</p>}
          {(reqs ?? []).map((r) => { const rec = recFor(r.id); return (
            <div key={r.id} className="space-y-2 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-2"><p><span className="text-muted">{who(r.requested_by)} asked to move </span><span className="tabular">{fmtDate(r.previous_deadline, ctx.tz, true)} → <strong>{fmtDate(r.requested_deadline, ctx.tz, true)}</strong></span></p>
                <Badge tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : 'info'}>{r.status.replace(/_/g, ' ')}</Badge></div>
              <p className="text-muted">“{r.reason}”</p>
              {r.employee_response && <p className="text-xs"><span className="text-muted">Employee response: </span>{r.employee_response}</p>}
              {r.decided_by && <p className="text-xs text-muted">{r.status} by {who(r.decided_by)} on {fmtDate(r.decided_at, ctx.tz, true)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>}
              {rec && <AiBox verdict={rec.verdict} text={rec.recommendation} factors={rec.factors?.items} source={rec.provider} />}
              <ExtensionDecision requestId={r.id} status={r.status} canDecide={ctx.isManager && r.requested_by !== ctx.userId} isRequester={r.requested_by === ctx.userId} /></div>); })}
          {active && mine && !(reqs ?? []).some((r) => ['pending', 'clarification_requested'].includes(r.status)) && <div className="px-4 py-3"><ExtensionButton taskId={id} currentDeadline={t.current_deadline} originalDeadline={t.original_deadline} tz={ctx.tz} /></div>}</div></Card>

        <Card><CardHeader title="Blockers" action={active && mine ? <BlockerButton taskId={id} people={members.map((m) => ({ id: m.id, label: m.name }))} departments={(departments ?? []).map((d) => ({ id: d.id, label: d.name }))} /> : undefined} />
          {(blockers ?? []).length === 0 ? <p className="px-4 py-4 text-xs text-muted">Nothing is blocking this task.</p> : <ul className="divide-y">{(blockers ?? []).map((b) => (
            <li key={b.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13px]"><div><p>{b.description}</p><p className="mt-0.5 text-xs text-muted">{who(b.reported_by)} · {fmtDate(b.reported_at, ctx.tz)} · {b.category.replace(/_/g, ' ')}{b.is_external && ' · external'}{b.responsible_user_id && ` · waiting on ${who(b.responsible_user_id)}`}{b.expected_resolution_date && ` · expected ${fmtDate(b.expected_resolution_date, ctx.tz)}`}</p>
              {b.resolution_note && <p className="mt-0.5 text-xs">Resolved: {b.resolution_note}</p>}</div>
              {b.status === 'open' ? <ResolveBlocker id={b.id} /> : <Badge tone="ok">Resolved</Badge>}</li>))}</ul>}</Card>

        <Card><CardHeader title="Discussion & files" /><div className="space-y-3 px-4 py-3">
          {(comments ?? []).map((c) => <div key={c.id} className="flex gap-2 text-[13px]"><Avatar name={who(c.author_id)} url={mm.get(c.author_id)?.avatar} size={22} /><div><p><strong className="font-medium">{who(c.author_id)}</strong> <span className="text-xs text-subtle">{fmtDate(c.created_at, ctx.tz, true)}</span></p><p className="whitespace-pre-wrap text-muted">{c.body}</p></div></div>)}
          {(atts ?? []).length > 0 && <ul className="flex flex-wrap gap-2">{(atts ?? []).map((a) => <li key={a.id}><a href={a.cloudinary_url} target="_blank" rel="noopener noreferrer" className="rounded border px-2 py-1 text-xs hover:bg-surface-2">{a.original_filename ?? 'Attachment'}</a></li>)}</ul>}
          <CommentForm id={id} />{mine && <AttachmentAdder companyId={ctx.companyId} taskId={id} />}</div></Card>
      </div>

      <aside className="space-y-5">
        <Card><div className="space-y-3 px-4 py-3 text-[13px]">
          <div><p className="text-xs text-muted">Progress</p><div className="mt-1 flex items-center gap-2"><Progress value={t.progress} /><span className="tabular text-xs">{t.progress}%</span></div></div>
          <div><p className="text-xs text-muted">Deadline</p><p className="tabular font-medium">{fmtDate(t.current_deadline, ctx.tz, true)}</p>
            {extended ? <p className="text-xs text-warn">Extended. Originally {fmtDate(t.original_deadline, ctx.tz, true)}</p> : <p className="text-xs text-subtle">{['draft', 'pending_approval', 'submitted', 'rejected'].includes(status) ? 'Not locked until approved' : 'Locked at approval'}</p>}</div>
          <div><p className="text-xs text-muted">Estimate</p><p className="tabular">{t.estimated_hours ?? '—'}h{t.ai_suggested_hours ? <span className="text-xs text-subtle"> · AI suggests ~{t.ai_suggested_hours}h</span> : null}</p></div>
          <div><p className="text-xs text-muted">Assigned to</p><ul className="mt-1 space-y-1">{assigneeIds.map((u) => <li key={u} className="flex items-center gap-2"><Avatar name={who(u)} url={mm.get(u)?.avatar} size={20} />{who(u)}</li>)}</ul></div>
          <div><p className="text-xs text-muted">Created by</p><p>{who(t.creator_id)} · {fmtDate(t.created_at, ctx.tz)}</p></div>
          {t.completed_at && <div><p className="text-xs text-muted">Completed</p><p>{fmtDate(t.completed_at, ctx.tz, true)}{t.original_deadline && <span className={t.completed_at <= t.original_deadline ? 'text-ok' : 'text-danger'}> · {t.completed_at <= t.original_deadline ? 'on time' : 'after original deadline'}</span>}</p></div>}
        </div></Card>
        <Card><CardHeader title="Activity" description="Permanent record" />
          {(logs ?? []).length === 0 ? <EmptyState title="No activity yet" /> : <ol className="max-h-[32rem] space-y-3 overflow-y-auto px-4 py-3">{(logs ?? []).map((l) => (
            <li key={l.id} className="text-xs"><p><span className="font-medium">{EVENT_LABEL[l.event] ?? l.event}</span> <span className="text-subtle">· {who(l.actor_id)}</span></p>
              {describe(l, ctx.tz) && <p className="text-muted">{describe(l, ctx.tz)}</p>}<p className="text-[11px] text-subtle">{fmtDate(l.created_at, ctx.tz, true)}</p></li>))}</ol>}</Card>
      </aside>
    </div>);
}

function AiEstimate({ e }: { e: any }) {
  return (<AiBox verdict={e.verdict} source={e.provider} factors={e.missing_information?.length ? [`Missing: ${e.missing_information.join('; ')}`] : []}
    text={`Employee estimate ${e.employee_estimate_hours ?? '—'}h. Suggested range ${e.recommended_min_hours}–${e.recommended_max_hours}h. ${e.explanation}`} history={e.used_company_history} />);
}
function AiBox({ verdict, text, factors, source, history }: { verdict: string | null; text: string; factors?: string[]; source?: string | null; history?: boolean }) {
  const tone = verdict === 'reasonable' ? 'ok' : verdict === 'insufficient_info' ? 'neutral' : 'warn';
  return (<div className="rounded-md border bg-surface-2/60 p-3 text-[13px]"><div className="mb-1 flex items-center gap-2 text-xs"><Sparkles className="size-3.5 text-accent" /><span className="font-medium">AI advice</span>
    {verdict && <Badge tone={tone}>{verdict.replace(/_/g, ' ')}</Badge>}<span className="text-subtle">{source === 'heuristic' ? 'rule-based check' : source}</span>{history === false && <span className="text-subtle">· general complexity, no company history</span>}</div>
    <p>{text}</p>{factors && factors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted">{factors.map((f, i) => <li key={i}>{f}</li>)}</ul>}</div>);
}
