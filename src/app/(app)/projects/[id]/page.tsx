import { notFound } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, getMembers, memberMap } from '@/lib/data';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/primitives';
import { ProjectUpdateForm } from '@/components/forms/project-update-form';
import { DeleteProjectButton, EtaPanel, MembersEditor, ProjectDescriptionEditor, ProjectStatusControl, ScopeEditor } from '@/components/projects/project-panels';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const ctx = await getCtx(); const sb = await createClient();
  const { data: p } = await sb.from('projects').select('*').eq('id', id).eq('company_id', ctx.companyId).maybeSingle();
  if (!p) notFound();
  const isAdmin = ctx.roles.includes('admin');

  const [members, { data: scopeItems }, { data: projMembers }, { data: updates }, { data: evals }, { data: tasks }] = await Promise.all([
    getMembers(sb, ctx.companyId),
    sb.from('project_scope_items').select('id, title, weight, estimated_hours, completion, suggested_by_ai').eq('project_id', id).order('sort_order'),
    sb.from('project_members').select('user_id').eq('project_id', id),
    sb.from('project_updates').select('id, user_id, body, hours, source, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('project_update_evaluations').select('update_id, contributes, reasoning, changes, source').eq('project_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('tasks').select('id, title, task_assignees!inner(user_id)').eq('company_id', ctx.companyId).eq('task_assignees.user_id', ctx.userId).in('status', ['approved', 'in_progress', 'blocked', 'under_review']),
  ]);

  const mm = memberMap(members);
  const who = (u: string) => mm.get(u)?.name ?? 'Unknown';
  const evalByUpdate = new Map((evals ?? []).map((e) => [e.update_id, e]));
  const assignedIds = (projMembers ?? []).map((m) => m.user_id);
  const isMember = assignedIds.includes(ctx.userId);
  const myProjectOption = isMember ? [{ id: p.id, label: p.name }] : [];

  const STATUS_TONE = { planning: 'neutral', active: 'accent', on_hold: 'warn', completed: 'ok', cancelled: 'neutral' } as const;

  return (<>
    <PageHeader title={p.name} description={`${p.progress}% complete`}
      actions={<div className="flex items-center gap-2"><Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE]}>{p.status.replace('_', ' ')}</Badge>
        {isAdmin && <ProjectStatusControl projectId={p.id} status={p.status} />}{isAdmin && <DeleteProjectButton projectId={p.id} />}</div>} />
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card><CardHeader title="About" /><div className="px-4 py-3"><ProjectDescriptionEditor projectId={p.id} description={p.description} canEdit={isAdmin} /></div></Card>

        <Card><CardHeader title="Scope" description="What “done” means for this product. Progress is a weighted average of these items." /><ScopeEditor projectId={p.id} items={scopeItems ?? []} canEdit={isAdmin} /></Card>

        <Card><CardHeader title="Updates" description="Staff updates and the AI's judgement on whether each one advanced the product." />
          {isMember && <div className="border-b p-4"><ProjectUpdateForm projects={myProjectOption} tasks={(tasks ?? []).map((t) => ({ id: t.id, label: t.title }))} fixedProjectId={p.id} /></div>}
          <div className="divide-y">
            {(updates ?? []).map((u) => {
              const ev = evalByUpdate.get(u.id);
              return (<div key={u.id} className="px-4 py-3">
                <p className="text-[13px]"><strong className="font-medium">{who(u.user_id)}</strong>{u.hours && <span className="text-muted"> · {Number(u.hours)}h</span>}
                  <span className="ml-1.5 text-[11px] text-subtle">{fmtDate(u.created_at, ctx.tz, true)}</span></p>
                <p className="mt-0.5 text-[13px] text-muted">{u.body}</p>
                {ev && (
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <Badge tone={ev.contributes ? 'ok' : 'neutral'}>{ev.contributes ? 'Advanced scope' : 'No progress change'}</Badge>
                    <p className="text-[11px] text-subtle">{ev.reasoning}</p>
                  </div>)}
                {ev?.contributes && Array.isArray(ev.changes) && ev.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-1 text-[11px] text-subtle">
                    {(ev.changes as Array<{ title: string; from: number; to: number }>).map((c, i) => <li key={i}>{c.title}: {c.from}% → {c.to}%</li>)}
                  </ul>)}
              </div>);
            })}
            {!updates?.length && <EmptyState title="No updates yet" description="Updates posted against this product will appear here with the AI's judgement." />}
          </div>
        </Card>
      </div>
      <aside className="space-y-5">
        <Card><CardHeader title="ETA" /><EtaPanel projectId={p.id} aiEta={p.ai_eta} aiExplanation={p.ai_eta_explanation} aiAssumptions={(p.ai_eta_assumptions as string[]) ?? []}
          projectedEta={p.projected_eta} projectedNote={p.projected_eta_note} targetDate={p.target_date} canEdit={isAdmin} tz={ctx.tz} /></Card>
        <Card><CardHeader title="Team" description={`${assignedIds.length} assigned`} />
          {isAdmin ? <MembersEditor projectId={p.id} all={members.filter((m) => m.id !== ctx.userId).map((m) => ({ id: m.id, label: m.name }))} assignedIds={assignedIds} />
            : <ul className="space-y-1.5 px-4 py-3 text-[13px]">{assignedIds.map((uid) => <li key={uid}>{who(uid)}</li>)}{!assignedIds.length && <li className="text-xs text-muted">No one assigned yet.</li>}</ul>}
        </Card>
      </aside>
    </div>
  </>);
}
