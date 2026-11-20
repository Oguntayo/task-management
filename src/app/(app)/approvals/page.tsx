import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap, UNPLANNED_COLS, type UnplannedRow } from '@/lib/data';
import { Badge, Card, CardHeader, EmptyState, PageHeader, PriorityBadge, WorkTypeBadge } from '@/components/ui/primitives';
import { can } from '@/lib/domain/permissions';
import { Sparkles } from 'lucide-react';

export const metadata = { title: 'Approvals' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  if (!(can(ctx.roles, 'tasks.approve') || can(ctx.roles, 'unplanned.verify'))) redirect('/dashboard');
  const [members, { data: tasks }, { data: reqs }, { data: recs }, { data: unplanned }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('tasks').select('id, title, priority, estimated_hours, ai_suggested_hours, current_deadline, creator_id, created_at').eq('company_id', ctx.companyId).in('status', ['submitted', 'pending_approval']).order('created_at'),
    sb.from('task_deadline_change_requests').select('id, task_id, requested_by, previous_deadline, requested_deadline, reason, status, tasks(title)').eq('company_id', ctx.companyId).in('status', ['pending', 'clarification_requested']).order('created_at'),
    sb.from('ai_recommendations').select('deadline_request_id, verdict, recommendation').eq('company_id', ctx.companyId).eq('kind', 'deadline_extension'),
    sb.from('unplanned_work_entries').select(UNPLANNED_COLS).eq('company_id', ctx.companyId).in('review_status', ['reported', 'needs_further_review']).order('occurred_at', { ascending: false }),
  ]);
  const mm = memberMap(members); const recBy = new Map((recs ?? []).map((r) => [r.deadline_request_id, r]));
  const rows = (unplanned ?? []) as unknown as UnplannedRow[];
  return (<>
    <PageHeader title="Approvals" description="Decisions waiting on you. AI advice is shown where it exists, but you decide." />
    <div className="space-y-5">
      <Card><CardHeader title={`Task commitments (${tasks?.length ?? 0})`} />{!tasks?.length ? <EmptyState title="No tasks waiting for approval" /> : <ul className="divide-y">{tasks.map((t) => (
        <li key={t.id}><Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2/60"><div><p className="text-[13px] font-medium">{t.title}</p><p className="text-[11px] text-subtle">{mm.get(t.creator_id)?.name} · {t.estimated_hours}h estimated{t.ai_suggested_hours ? ` · AI ~${t.ai_suggested_hours}h` : ''} · due {fmtDate(t.current_deadline, ctx.tz, true)}</p></div><PriorityBadge priority={t.priority} /></Link></li>))}</ul>}</Card>
      <Card><CardHeader title={`Deadline extensions (${reqs?.length ?? 0})`} />{!reqs?.length ? <EmptyState title="No extension requests" /> : <ul className="divide-y">{reqs.map((r: any) => { const rec = recBy.get(r.id); return (
        <li key={r.id}><Link href={`/tasks/${r.task_id}`} className="block px-4 py-3 hover:bg-surface-2/60"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] font-medium">{r.tasks?.title}</p><Badge tone="info">{r.status.replace(/_/g, ' ')}</Badge></div>
          <p className="text-[11px] text-subtle">{mm.get(r.requested_by)?.name} · {fmtDate(r.previous_deadline, ctx.tz, true)} → {fmtDate(r.requested_deadline, ctx.tz, true)}</p><p className="mt-1 text-xs text-muted">“{r.reason}”</p>
          {rec && <p className="mt-1.5 flex items-start gap-1.5 text-xs"><Sparkles className="mt-0.5 size-3 shrink-0 text-accent" /><span>{rec.recommendation}</span></p>}</Link></li>); })}</ul>}</Card>
      <Card><CardHeader title={`Unplanned work to review (${rows.length})`} />{!rows.length ? <EmptyState title="No unplanned work waiting" /> : <ul className="divide-y">{rows.map((u) => (
        <li key={u.id}><Link href={`/unplanned/${u.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2/60"><div><p className="text-[13px] font-medium">{u.title}</p><p className="text-[11px] text-subtle">{mm.get(u.user_id)?.name} · {Number(u.hours_spent)}h · {fmtDate(u.occurred_at, ctx.tz, true)}</p></div><div className="flex gap-2"><WorkTypeBadge unplanned urgent={u.is_urgent} />{u.review_status === 'needs_further_review' && <Badge tone="warn">needs further review</Badge>}</div></Link></li>))}</ul>}</Card>
    </div></>);
}
