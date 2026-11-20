import Link from 'next/link';
import { Plus, Rocket } from 'lucide-react';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/data';
import { Badge, Card, EmptyState, PageHeader, Progress } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Products' };

const STATUS_TONE = { planning: 'neutral', active: 'accent', on_hold: 'warn', completed: 'ok', cancelled: 'neutral' } as const;

export default async function Page() {
  const ctx = await getCtx(); const sb = await createClient();
  const { data } = await sb.from('projects')
    .select('id, name, description, status, progress, ai_eta, projected_eta, target_date, project_members(user_id)')
    .eq('company_id', ctx.companyId).order('created_at', { ascending: false });
  const projects = data ?? [];
  const isAdmin = ctx.roles.includes('admin');

  return (<>
    <PageHeader title="Products" description={isAdmin ? 'What the company is building — assign people, track AI-estimated progress.' : 'Products you are assigned to.'}
      actions={isAdmin && <Link href="/projects/new"><Button variant="primary"><Plus className="size-3.5" />New product</Button></Link>} />
    {!projects.length ? (
      <Card><EmptyState icon={<Rocket className="size-8" />} title="No products yet"
        description={isAdmin ? 'Create your first product to start assigning staff and tracking AI-estimated progress.' : 'Your admin hasn’t assigned you to a product yet.'}
        action={isAdmin && <Link href="/projects/new"><Button variant="primary"><Plus className="size-3.5" />New product</Button></Link>} /></Card>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="block">
            <Card className="h-full p-4 transition-colors hover:bg-surface-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-tight">{p.name}</h3>
                <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE]}>{p.status.replace('_', ' ')}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>
              <div className="mt-4"><div className="mb-1 flex justify-between text-[11px] text-subtle"><span>{p.progress}% complete</span><span>{(p.project_members ?? []).length} on team</span></div>
                <Progress value={p.progress} /></div>
              <p className="mt-3 text-[11px] text-subtle">
                {p.projected_eta ? <>Projected ETA {fmtDate(p.projected_eta, ctx.tz)}</> : p.ai_eta ? <>AI estimate {fmtDate(p.ai_eta, ctx.tz)}</> : 'No ETA yet'}
                {p.target_date && <> · Target {fmtDate(p.target_date, ctx.tz)}</>}
              </p>
            </Card>
          </Link>))}
      </div>)}
  </>);
}
