import Link from 'next/link';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap, UNPLANNED_COLS, type UnplannedRow } from '@/lib/data';
import { Badge, Card, EmptyState, PageHeader, Stat, WorkTypeBadge } from '@/components/ui/primitives';

export const metadata = { title: 'Unplanned work' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  let q = sb.from('unplanned_work_entries').select(UNPLANNED_COLS).eq('company_id', ctx.companyId).order('occurred_at', { ascending: false }).limit(200);
  if (!ctx.isLeader) q = q.eq('user_id', ctx.userId);
  const [{ data }, members] = await Promise.all([q, getMembers(sb, ctx.companyId)]);
  const rows = (data ?? []) as unknown as UnplannedRow[]; const mm = memberMap(members);
  const counted = rows.filter((r) => r.review_status !== 'rejected');
  const mine = counted.filter((r) => r.user_id === ctx.userId);
  return (<>
    <PageHeader title="Unplanned work" description={ctx.isLeader ? 'Everything the team handled outside their plan.' : 'Work that came up outside your plan. It counts as real work and stays separate from your commitments.'} />
    <Card className="mb-5 grid grid-cols-3 divide-x"><Stat label="Entries" value={counted.length} /><Stat label="Hours" value={`${Math.round(counted.reduce((s, r) => s + Number(r.hours_spent), 0) * 10) / 10}h`} hint="rejected entries excluded" /><Stat label="Urgent" value={counted.filter((r) => r.is_urgent).length} hint={ctx.isLeader ? `${mine.length} yours` : undefined} /></Card>
    <Card>{rows.length === 0 ? <EmptyState title="No unplanned work yet" description="When something urgent interrupts your plan, use “Log unplanned work” in the header." /> :
      <ul className="divide-y">{rows.map((u) => (
        <li key={u.id}><Link href={`/unplanned/${u.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2/60">
          <div className="min-w-0"><p className="truncate text-[13px] font-medium">{u.title}</p><p className="text-[11px] text-subtle">{mm.get(u.user_id)?.name} · {fmtDate(u.occurred_at, ctx.tz, true)}{u.incident_reference && ` · ${u.incident_reference}`}{u.projects && ` · ${u.projects.name}`}</p></div>
          <div className="flex items-center gap-2"><span className="tabular text-xs text-muted">{Number(u.hours_spent)}h</span><WorkTypeBadge unplanned urgent={u.is_urgent} />
            <Badge tone={u.review_status === 'approved' ? 'ok' : u.review_status === 'rejected' ? 'danger' : 'neutral'}>{u.review_status.replace(/_/g, ' ')}</Badge>
            {u.verified_by && <Badge tone="info">verified</Badge>}{u.admin_approved_by && <Badge tone="ok">admin approved</Badge>}</div></Link></li>))}</ul>}</Card></>);
}
