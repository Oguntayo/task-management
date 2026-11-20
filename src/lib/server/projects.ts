import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyEvaluation, projectedEta, type ScopeItem } from '@/lib/domain/projects';
import { evaluateUpdate } from '@/lib/ai/projects';
import { toLocalDate } from '@/lib/domain/dates';

/**
 * Judges one staff update against its product and, only if it genuinely contributes, advances scope items.
 * Not a user action: it runs with the service role because clients can never write progress.
 * Always writes an evaluation row (contributes true/false) so every AI decision is reviewable; a "no" changes nothing.
 */
export async function processProjectUpdate(updateId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { data: u } = await admin.from('project_updates').select('*, tasks(title)').eq('id', updateId).single();
    if (!u) return;
    const [{ data: project }, { data: itemRows }, { data: company }] = await Promise.all([
      admin.from('projects').select('id, name, description, status, start_date, company_id').eq('id', u.project_id).single(),
      admin.from('project_scope_items').select('id, title, description, weight, estimated_hours, completion').eq('project_id', u.project_id).order('sort_order'),
      admin.from('companies').select('timezone, settings').eq('id', u.company_id).single(),
    ]);
    if (!project || project.status === 'cancelled' || project.status === 'completed') return;
    const items: ScopeItem[] = (itemRows ?? []).map((i: any) => ({ ...i, estimated_hours: i.estimated_hours === null ? null : Number(i.estimated_hours) }));
    if (!items.length) {
      await admin.from('project_update_evaluations').insert({ company_id: u.company_id, project_id: u.project_id, update_id: u.id, contributes: false,
        reasoning: 'This product has no scope items yet, so progress cannot be measured. An admin should add scope items.', changes: [], progress_before: 0, progress_after: 0, source: 'heuristic' });
      return;
    }
    const ev = await evaluateUpdate({ projectName: project.name, projectDescription: project.description, items, updateText: u.body,
      hours: u.hours === null ? null : Number(u.hours), source: u.source, taskTitle: (u.tasks as any)?.title ?? null });
    const applied = applyEvaluation({ items, contributes: ev.contributes, proposed: ev.proposed, source: u.source });
    const appliedChanges = [];
    for (const c of applied.changes) {
      // optimistic guard: only ever raise a value, even if two updates are processed concurrently
      const { data: row } = await admin.from('project_scope_items').update({ completion: c.to }).eq('id', c.item_id).lt('completion', c.to).select('id');
      if (row?.length) appliedChanges.push(c);
    }
    const { data: after } = await admin.from('projects').select('progress').eq('id', u.project_id).single();
    const progressAfter = after?.progress ?? applied.progressAfter;
    if (appliedChanges.length) {
      const tz = (company?.timezone as string) ?? 'UTC';
      const proj = projectedEta({ start: project.start_date, today: toLocalDate(new Date(), tz), progress: progressAfter, weekdays: company?.settings?.working_days });
      await admin.from('projects').update({ projected_eta: proj.eta, projected_eta_note: proj.note }).eq('id', u.project_id);
    }
    await admin.from('project_update_evaluations').insert({ company_id: u.company_id, project_id: u.project_id, update_id: u.id,
      contributes: appliedChanges.length > 0, reasoning: ev.reasoning, changes: appliedChanges, progress_before: applied.progressBefore, progress_after: progressAfter,
      source: ev.source, provider: ev.source === 'ai' ? ev.provider : 'heuristic', model: ev.model ?? null });
  } catch (e) { console.error('[project-update]', (e as Error).message); }   // never blocks the staff member's update
}
