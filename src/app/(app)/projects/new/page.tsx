import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { getMembers } from '@/lib/data';
import { PageHeader, Card } from '@/components/ui/primitives';
import { ProjectForm } from '@/components/forms/project-form';

export const metadata = { title: 'New product' };
export default async function Page() {
  const ctx = await getCtx();
  if (!ctx.roles.includes('admin')) redirect('/projects');
  const members = await getMembers(await createClient(), ctx.companyId);
  return (<div className="mx-auto max-w-2xl">
    <PageHeader title="New product" description="Tell the AI what you're building, and assign the people working on it." />
    <Card className="p-5"><ProjectForm people={members.filter((m) => m.id !== ctx.userId).map((m) => ({ id: m.id, label: m.name }))} /></Card>
  </div>);
}
