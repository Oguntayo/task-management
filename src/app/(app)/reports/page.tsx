import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { toLocalDate, weekStart } from '@/lib/domain/dates';
import { PageHeader } from '@/components/ui/primitives';
import { DailyReportPanel, WeeklyReportPanel } from '@/components/reports/report-panels';

export const metadata = { title: 'My reports' };
export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  const today = toLocalDate(new Date(), ctx.tz); const ws = weekStart(today);
  const [{ data: daily }, { data: weekly }] = await Promise.all([
    sb.from('standup_reports').select('generated, status').eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('report_date', today).maybeSingle(),
    sb.from('weekly_reports').select('generated, status').eq('company_id', ctx.companyId).eq('user_id', ctx.userId).eq('week_start', ws).maybeSingle(),
  ]);
  return (<>
    <PageHeader title="My reports" description="Generated from your own records, so nothing you didn't actually do shows up here." />
    <div className="space-y-5">
      <DailyReportPanel date={today} existing={daily?.generated && Object.keys(daily.generated).length ? daily.generated : null} status={(daily?.status as 'draft' | 'submitted') ?? null} />
      <WeeklyReportPanel weekStartDate={ws} existing={weekly?.generated && Object.keys(weekly.generated).length ? weekly.generated : null} status={(weekly?.status as 'draft' | 'submitted') ?? null} />
    </div>
  </>);
}
