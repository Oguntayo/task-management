import { createClient } from '@/lib/supabase/server';
import { Badge, Card, PageHeader, Stat } from '@/components/ui/primitives';
import { CompanyStatusToggle } from '@/components/platform/company-status-toggle';

export const metadata = { title: 'Platform' };

export default async function Page() {
  const sb = await createClient();
  const [{ data: stats }, { data: companies }] = await Promise.all([
    sb.rpc('platform_stats'),
    sb.rpc('platform_list_companies'),
  ]);
  const s = (stats ?? {}) as Record<string, number>;
  return (<>
    <PageHeader title="Platform" description="Counts and account status only — tenant task content is never visible here." />
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card><Stat label="Companies" value={s.companies ?? 0} /></Card>
      <Card><Stat label="Active" value={s.active_companies ?? 0} /></Card>
      <Card><Stat label="Suspended" value={s.suspended_companies ?? 0} tone={s.suspended_companies ? 'danger' : undefined} /></Card>
      <Card><Stat label="Users" value={s.users ?? 0} /></Card>
      <Card><Stat label="Active memberships" value={s.memberships ?? 0} /></Card>
      <Card><Stat label="Tasks (30d)" value={s.tasks_last_30d ?? 0} /></Card>
    </div>
    <Card>
      <div className="border-b px-4 py-3"><h2 className="text-[13px] font-semibold">Companies</h2></div>
      <div className="divide-y">{(companies ?? []).map((c: any) => (
        <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div><p className="text-[13px] font-medium">{c.name} <span className="font-normal text-subtle">/{c.slug}</span></p>
            <p className="text-[11px] text-subtle">{c.member_count} member{c.member_count === 1 ? '' : 's'} · {c.plan} plan</p></div>
          <div className="flex items-center gap-2"><Badge tone={c.status === 'active' ? 'ok' : 'danger'}>{c.status}</Badge><CompanyStatusToggle companyId={c.id} status={c.status} /></div>
        </div>))}
        {!companies?.length && <p className="px-4 py-6 text-center text-xs text-muted">No companies yet.</p>}
      </div>
    </Card>
  </>);
}
