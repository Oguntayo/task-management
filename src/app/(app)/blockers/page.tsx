import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap } from '@/lib/data';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ResolveBlocker } from '@/components/tasks/task-panels';
import { can } from '@/lib/domain/permissions';

export const metadata = { title: 'Blockers' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  if (!can(ctx.roles, 'tasks.view_all')) redirect('/dashboard');
  const [members, { data }] = await Promise.all([getMembers(sb, ctx.companyId),
    sb.from('task_blockers').select('id, task_id, category, description, is_external, reported_by, responsible_user_id, expected_resolution_date, reported_at, tasks(title)').eq('company_id', ctx.companyId).eq('status', 'open').order('reported_at')]);
  const mm = memberMap(members); const age = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return (<><PageHeader title="Open blockers" description="Delays caused by something outside the task owner are marked external and are not counted against them." />
    <Card>{!data?.length ? <EmptyState title="Nothing is blocked" description="Reported blockers appear here until they are resolved." /> : <ul className="divide-y">{data.map((b: any) => (
      <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div className="min-w-0"><Link href={`/tasks/${b.task_id}`} className="text-[13px] font-medium hover:text-accent">{b.tasks?.title}</Link><p className="mt-0.5 text-[13px]">{b.description}</p>
        <p className="mt-1 text-xs text-muted">{mm.get(b.reported_by)?.name} · {age(b.reported_at)}d open · {b.category.replace(/_/g, ' ')}{b.responsible_user_id && ` · waiting on ${mm.get(b.responsible_user_id)?.name}`}{b.expected_resolution_date && ` · expected ${fmtDate(b.expected_resolution_date, ctx.tz)}`}</p></div>
        <div className="flex items-center gap-2">{b.is_external && <Badge tone="info">External</Badge>}<ResolveBlocker id={b.id} /></div></li>))}</ul>}</Card></>);
}
