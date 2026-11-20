import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/domain/permissions';
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { addCat, addDept, CompanySettingsForm, ListManager, removeCat, removeDept } from '@/components/settings/company-settings-form';

export const metadata = { title: 'Company settings' };
export default async function Page() {
  const ctx = await getCtx();
  if (!can(ctx.roles, 'company.manage')) redirect('/dashboard');
  const sb = await createClient();
  const [{ data: company }, { data: deps }, { data: cats }] = await Promise.all([
    sb.from('companies').select('name, industry, timezone, settings').eq('id', ctx.companyId).single(),
    sb.from('departments').select('id, name').eq('company_id', ctx.companyId).order('name'),
    sb.from('task_categories').select('id, name').eq('company_id', ctx.companyId).order('sort_order'),
  ]);
  return (<>
    <PageHeader title="Company settings" description={`Workspace address: ${ctx.active.company.slug}`} />
    <div className="space-y-5">
      <Card><CardHeader title="General" /><div className="p-4"><CompanySettingsForm name={company!.name} industry={company!.industry} timezone={company!.timezone} settings={company!.settings} /></div></Card>
      <Card><CardHeader title="Departments" description="Used to group people and tasks." /><div className="p-4"><ListManager title="" items={deps ?? []} onAdd={addDept} onRemove={removeDept} placeholder="e.g. Engineering" /></div></Card>
      <Card><CardHeader title="Task categories" /><div className="p-4"><ListManager title="" items={cats ?? []} onAdd={addCat} onRemove={removeCat} placeholder="e.g. Bug fix" /></div></Card>
    </div>
  </>);
}
