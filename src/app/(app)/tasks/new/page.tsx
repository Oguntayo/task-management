import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { getMembers } from '@/lib/data';
import { PageHeader, Card } from '@/components/ui/primitives';
import { TaskForm } from '@/components/forms/task-form';
import { toLocalDate, weekEnd, weekStart } from '@/lib/domain/dates';

export const metadata = { title: 'New task' };
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const ctx = await getCtx(); const sb = await createClient(); const { project } = await searchParams;
  const [{ data: cats }, { data: deps }, { data: projs }, members] = await Promise.all([
    sb.from('task_categories').select('id, name').eq('company_id', ctx.companyId).order('sort_order'),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId).order('name'),
    sb.from('projects').select('id, name').eq('company_id', ctx.companyId).in('status', ['planning', 'active']).order('name'),
    getMembers(sb, ctx.companyId)]);
  const today = toLocalDate(new Date(), ctx.tz);
  return (<div className="mx-auto max-w-2xl"><PageHeader title="New task" description="Commit to work, or add something that came up outside this week's plan." />
    <Card className="p-5"><TaskForm categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))} departments={(deps ?? []).map((d) => ({ id: d.id, label: d.name }))}
      projects={(projs ?? []).map((p) => ({ id: p.id, label: p.name }))} people={members.map((m) => ({ id: m.id, label: m.name }))} canAssign={ctx.isManager}
      weekStart={weekStart(today)} weekEnd={weekEnd(today)} defaultProjectId={project} /></Card></div>);
}
