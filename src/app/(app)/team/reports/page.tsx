import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap } from '@/lib/data';
import { toLocalDate, weekStart } from '@/lib/domain/dates';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import type { DailySummary, WeeklySummary } from '@/lib/domain/summaries';

export const metadata = { title: 'Team reports' };

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><p className="text-xs font-medium text-muted">{title}</p><ul className="mt-0.5 space-y-0.5 pl-4 text-[13px]">{items.map((t, i) => <li key={i} className="list-disc">{t}</li>)}</ul></div>;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string; date?: string }> }) {
  const ctx = await getCtx(); const sb = await createClient();
  const today = toLocalDate(new Date(), ctx.tz);
  const date = (await searchParams).date ?? today;
  const ws = weekStart((await searchParams).week ?? today);
  const members = await getMembers(sb, ctx.companyId); const mm = memberMap(members);

  const [{ data: dailies }, { data: weeklies }] = await Promise.all([
    sb.from('standup_reports').select('user_id, generated, status, submitted_at').eq('company_id', ctx.companyId).eq('report_date', date).eq('status', 'submitted'),
    sb.from('weekly_reports').select('user_id, generated, status, submitted_at').eq('company_id', ctx.companyId).eq('week_start', ws).eq('status', 'submitted'),
  ]);

  return (<>
    <PageHeader title="Team reports" description="Submitted stand-ups and weekly reports, built from each person's own task records." />
    <div className="grid gap-5 lg:grid-cols-2">
      <section><h2 className="mb-2 text-[13px] font-semibold">Stand-up · {fmtDate(`${date}T00:00:00`, ctx.tz)}</h2>
        {!dailies?.length ? <Card><EmptyState title="No stand-ups submitted yet" description="They'll appear here as people submit." /></Card> : (
          <div className="space-y-3">{dailies.map((d) => {
            const g = d.generated as DailySummary;
            return (<Card key={d.user_id}><CardHeader title={mm.get(d.user_id)?.name ?? 'Unknown'} description={d.submitted_at ? fmtDate(d.submitted_at, ctx.tz, true) : undefined} action={<Badge tone="ok">Submitted</Badge>} />
              <div className="space-y-2 px-4 py-3">
                <Section title="Completed" items={g.completed?.map((t) => t.title) ?? []} />
                <Section title="In progress" items={g.currentlyWorkingOn?.map((t) => `${t.title} (${t.progress}%)`) ?? []} />
                <Section title="Blocked" items={g.blocked?.map((t) => t.title) ?? []} />
              </div></Card>);
          })}</div>)}
      </section>
      <section><h2 className="mb-2 text-[13px] font-semibold">Weekly · week of {fmtDate(`${ws}T00:00:00`, ctx.tz)}</h2>
        {!weeklies?.length ? <Card><EmptyState title="No weekly reports submitted yet" description="They'll appear here as people submit." /></Card> : (
          <div className="space-y-3">{weeklies.map((w) => {
            const g = w.generated as WeeklySummary;
            return (<Card key={w.user_id}><CardHeader title={mm.get(w.user_id)?.name ?? 'Unknown'} description={w.submitted_at ? fmtDate(w.submitted_at, ctx.tz, true) : undefined} action={<Badge tone="ok">Submitted</Badge>} />
              <div className="space-y-2 px-4 py-3">
                <Section title="Completed" items={g.completed?.map((t) => t.title) ?? []} />
                <Section title="Overdue" items={g.overdue?.map((t) => t.title) ?? []} />
                {g.unplanned?.entries > 0 && <Section title="Unplanned" items={[`${g.unplanned.entries} entries, ${g.unplanned.hours}h`]} />}
              </div></Card>);
          })}</div>)}
      </section>
    </div>
  </>);
}
