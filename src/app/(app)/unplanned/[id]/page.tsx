import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap } from '@/lib/data';
import { Badge, Card, CardHeader, PageHeader, WorkTypeBadge } from '@/components/ui/primitives';
import { CommentForm } from '@/components/tasks/task-panels';
import { UnplannedReview } from '@/components/tasks/unplanned-panels';
import { UnplannedForm } from '@/components/forms/unplanned-form';
import { can } from '@/lib/domain/permissions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const ctx = await getCtx(); const sb = await createClient();
  const { data: e } = await sb.from('unplanned_work_entries').select('*, projects(id, name), tasks:related_task_id(id, title)').eq('id', id).eq('company_id', ctx.companyId).maybeSingle();
  if (!e) notFound();
  const [members, { data: logs }, { data: comments }, { data: atts }, { data: tasks }, { data: projs }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('task_activity_logs').select('id, actor_id, event, details, created_at').eq('unplanned_entry_id', id).order('created_at', { ascending: false }),
    sb.from('task_comments').select('id, author_id, body, created_at').eq('unplanned_entry_id', id).order('created_at'),
    sb.from('task_attachments').select('id, cloudinary_url, original_filename').eq('unplanned_entry_id', id),
    sb.from('tasks').select('id, title, task_assignees!inner(user_id)').eq('company_id', ctx.companyId).eq('task_assignees.user_id', ctx.userId).in('status', ['approved', 'in_progress', 'blocked', 'under_review']),
    sb.from('projects').select('id, name').eq('company_id', ctx.companyId).in('status', ['planning', 'active']),
  ]);
  const mm = memberMap(members); const who = (u: string | null) => (u && mm.get(u)?.name) || 'System';
  const own = e.user_id === ctx.userId; const editable = own && ['reported', 'clarification_requested'].includes(e.review_status);
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 whitespace-pre-wrap text-[13px]">{v}</dd></div>;
  return (<>
    <PageHeader title={e.title} description={`${who(e.user_id)} · ${fmtDate(e.occurred_at, ctx.tz, true)}`} actions={<WorkTypeBadge unplanned urgent={e.is_urgent} />} />
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-5">
      {e.review_status === 'clarification_requested' && own && <Card className="border-warn/40 bg-warn-soft p-4 text-[13px]"><p className="font-medium text-warn">Your PM asked for clarification</p><p className="mt-1">{e.review_note}</p><p className="mt-2 text-xs text-muted">Edit the details below and save to resubmit.</p></Card>}
      <Card><dl className="divide-y"><Row k="What happened" v={e.what_happened} /><Row k="Action taken" v={e.action_taken} /><Row k="Why it was necessary" v={e.why_necessary} />
        <div className="grid grid-cols-2 divide-x sm:grid-cols-4"><Row k="Time spent" v={`${Number(e.hours_spent)}h`} /><Row k="Status" v={e.work_status.replace(/_/g, ' ')} /><Row k="Priority" v={e.priority} /><Row k="Reference" v={e.incident_reference ?? '—'} /></div>
        <div className="grid grid-cols-2 divide-x"><Row k="Requested by" v={e.requested_by_user_id ? who(e.requested_by_user_id) : e.requested_by_name ?? '—'} />
          <Row k="Related" v={<>{e.tasks && <Link className="text-accent hover:underline" href={`/tasks/${e.tasks.id}`}>{e.tasks.title}</Link>}{e.projects && <span className="block"><Link className="text-accent hover:underline" href={`/projects/${e.projects.id}`}>{e.projects.name}</Link></span>}{!e.tasks && !e.projects && '—'}</>} /></div>
        {(atts ?? []).length > 0 && <Row k="Evidence" v={<span className="flex flex-wrap gap-2">{(atts ?? []).map((a) => <a key={a.id} href={a.cloudinary_url} target="_blank" rel="noopener noreferrer" className="rounded border px-2 py-1 text-xs hover:bg-surface-2">{a.original_filename ?? 'File'}</a>)}</span>} />}</dl></Card>
      <Card><CardHeader title="Review chain" description="Reported by the employee, then reviewed, verified and approved by others." /><div className="space-y-2 px-4 py-3 text-[13px]">
        <p><Badge tone="neutral">Reported</Badge> by {who(e.user_id)}</p>
        <p><Badge tone={e.review_status === 'approved' ? 'ok' : e.review_status === 'rejected' ? 'danger' : 'neutral'}>{e.reviewed_by ? e.review_status.replace(/_/g, ' ') : 'Awaiting PM review'}</Badge>{e.reviewed_by && <> by {who(e.reviewed_by)} · {fmtDate(e.reviewed_at, ctx.tz, true)}{e.review_note && ` — ${e.review_note}`}</>}</p>
        <p><Badge tone={e.verified_by ? 'info' : 'neutral'}>{e.verified_by ? 'Verified' : 'Not technically verified'}</Badge>{e.verified_by && <> by {who(e.verified_by)}</>}</p>
        <p><Badge tone={e.admin_approved_by ? 'ok' : 'neutral'}>{e.admin_approved_by ? 'Admin approved' : 'Not admin approved'}</Badge>{e.admin_approved_by && <> by {who(e.admin_approved_by)}</>}</p>
        {!own && <UnplannedReview id={id} canReview={ctx.isManager} canVerify={can(ctx.roles, 'unplanned.verify')} canAdminApprove={can(ctx.roles, 'unplanned.admin_approve')} verified={!!e.verified_by} adminApproved={!!e.admin_approved_by} />}</div></Card>
      {editable && <Card><CardHeader title="Edit details" description="Allowed until the entry has been reviewed." /><div className="p-4"><UnplannedForm companyId={ctx.companyId} entryId={id} projects={(projs ?? []).map((p) => ({ id: p.id, label: p.name }))} tasks={(tasks ?? []).map((t) => ({ id: t.id, label: t.title }))} members={members.filter((m) => m.id !== ctx.userId).map((m) => ({ id: m.id, label: m.name }))}
        initial={{ title: e.title, whatHappened: e.what_happened, actionTaken: e.action_taken, whyNecessary: e.why_necessary, hoursSpent: Number(e.hours_spent), priority: e.priority, isUrgent: e.is_urgent, workStatus: e.work_status, incidentReference: e.incident_reference ?? '', occurredAt: new Date(e.occurred_at).toISOString().slice(0, 16), projectId: e.project_id ?? '', relatedTaskId: e.related_task_id ?? '', requestedByUserId: e.requested_by_user_id ?? '' }} /></div></Card>}
      <Card><CardHeader title="Discussion" /><div className="space-y-3 px-4 py-3">{(comments ?? []).map((c) => <p key={c.id} className="text-[13px]"><strong className="font-medium">{who(c.author_id)}</strong> <span className="text-xs text-subtle">{fmtDate(c.created_at, ctx.tz, true)}</span><br /><span className="text-muted">{c.body}</span></p>)}<CommentForm id={id} kind="unplanned" /></div></Card>
    </div>
    <aside><Card><CardHeader title="History" description="Permanent record" /><ol className="space-y-3 px-4 py-3">{(logs ?? []).map((l) => <li key={l.id} className="text-xs"><p className="font-medium">{l.event.replace(/^unplanned_/, '').replace(/_/g, ' ')} <span className="font-normal text-subtle">· {who(l.actor_id)}</span></p>{l.details?.note && <p className="text-muted">{l.details.note}</p>}<p className="text-[11px] text-subtle">{fmtDate(l.created_at, ctx.tz, true)}</p></li>)}</ol></Card></aside></div></>);
}
