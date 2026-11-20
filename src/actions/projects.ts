'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCtx } from '@/lib/auth/context';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { planProject } from '@/lib/ai/projects';
import { processProjectUpdate } from '@/lib/server/projects';
import { toLocalDate } from '@/lib/domain/dates';
import { flattenErrors } from '@/lib/validation';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';

const uuid = z.string().uuid();
const projectSchema = z.object({
  name: z.string().trim().min(2, 'Name the product').max(120),
  description: z.string().trim().min(10, 'Describe what is being built (a few sentences helps the AI plan it)').max(5000),
  startDate: z.string().optional().or(z.literal('').transform(() => undefined)),
  targetDate: z.string().optional().or(z.literal('').transform(() => undefined)),
  memberIds: z.array(uuid).max(100).default([]),
  scopeItems: z.array(z.object({ title: z.string().trim().min(2).max(200), estimatedHours: z.coerce.number().positive().max(10000).optional().or(z.literal('').transform(() => undefined)) })).max(20).default([]),
});

async function planAndStore(projectId: string, ctx: Awaited<ReturnType<typeof getCtx>>, mode: 'create' | 'refresh') {
  const admin = createAdminClient();
  const { data: p } = await admin.from('projects').select('name, description, start_date').eq('id', projectId).eq('company_id', ctx.companyId).single();
  if (!p) return;
  const { data: items } = await admin.from('project_scope_items').select('id, title, estimated_hours').eq('project_id', projectId).order('sort_order');
  const { count } = await admin.from('project_members').select('user_id', { count: 'exact', head: true }).eq('project_id', projectId);
  const plan = await planProject({ name: p.name, description: p.description, startDate: p.start_date, teamSize: count ?? 0, hoursPerDay: ctx.settings.working_hours_per_day,
    weekdays: ctx.settings.working_days, existingItems: (items ?? []).map((i) => ({ title: i.title, estimated_hours: i.estimated_hours === null ? null : Number(i.estimated_hours) })) });
  if (!items?.length && mode === 'create') {
    await admin.from('project_scope_items').insert(plan.items.map((i, n) => ({ project_id: projectId, company_id: ctx.companyId, title: i.title, description: i.description ?? null,
      weight: i.weight, estimated_hours: i.estimated_hours, sort_order: n, suggested_by_ai: plan.source === 'ai' })));
  } else if (items?.length) {
    // keep the admin's items; only fill missing hour estimates / weights where the plan names the same item
    for (const it of items) {
      const match = plan.items.find((x) => x.title.toLowerCase() === it.title.toLowerCase());
      if (match) await admin.from('project_scope_items').update({ weight: match.weight, ...(it.estimated_hours === null && match.estimated_hours ? { estimated_hours: match.estimated_hours } : {}) }).eq('id', it.id);
    }
  }
  await admin.from('projects').update({ ai_eta: plan.eta, ai_eta_explanation: plan.explanation, ai_eta_assumptions: plan.assumptions, ai_eta_source: plan.source }).eq('id', projectId);
}

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await getCtx();
  if (!ctx.roles.includes('admin')) return fail('Only admins can create products.');
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data, sb = await createClient();
  const { data: p, error } = await sb.from('projects').insert({ company_id: ctx.companyId, name: d.name, description: d.description,
    start_date: d.startDate ?? toLocalDate(new Date(), ctx.tz), target_date: d.targetDate ?? null, created_by: ctx.userId }).select('id').single();
  if (error) return fail(error.message.includes('duplicate') ? 'A product with this name already exists.' : friendlyDbError(error.message));
  if (d.memberIds.length) {
    const { error: e } = await sb.from('project_members').insert(d.memberIds.map((user_id) => ({ project_id: p.id, company_id: ctx.companyId, user_id, assigned_by: ctx.userId })));
    if (e) return fail(friendlyDbError(e.message));
  }
  if (d.scopeItems.length) {
    const w = Math.max(1, Math.round(100 / d.scopeItems.length));
    await sb.from('project_scope_items').insert(d.scopeItems.map((s, n) => ({ project_id: p.id, company_id: ctx.companyId, title: s.title, weight: w, estimated_hours: s.estimatedHours ?? null, sort_order: n })));
  }
  if (await rateLimit(createAdminClient(), `ai:${ctx.userId}`, LIMITS.ai.limit, LIMITS.ai.window)) await planAndStore(p.id, ctx, 'create');
  revalidatePath('/projects');
  return { ok: true, data: { id: p.id }, message: 'Product created' };
}

export async function refreshProjectEta(projectId: string): Promise<ActionResult> {
  const ctx = await getCtx(); if (!ctx.roles.includes('admin')) return fail('Only admins can do this.');
  if (!(await rateLimit(createAdminClient(), `ai:${ctx.userId}`, LIMITS.ai.limit, LIMITS.ai.window))) return fail('Too many AI requests. Try again in a minute.');
  await planAndStore(projectId, ctx, 'refresh'); revalidatePath(`/projects/${projectId}`); return { ok: true, message: 'ETA re-estimated' };
}

export async function updateProject(projectId: string, input: { name?: string; description?: string; status?: string; targetDate?: string | null }): Promise<ActionResult> {
  await getCtx();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.status && ['planning', 'active', 'on_hold', 'completed', 'cancelled'].includes(input.status)) patch.status = input.status;
  if (input.targetDate !== undefined) patch.target_date = input.targetDate || null;
  const { error } = await (await createClient()).from('projects').update(patch).eq('id', projectId);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/projects/${projectId}`); revalidatePath('/projects'); return { ok: true, message: 'Saved' };
}

export async function setProjectMembers(projectId: string, userIds: string[]): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const { data: cur } = await sb.from('project_members').select('user_id').eq('project_id', projectId);
  const have = new Set((cur ?? []).map((m) => m.user_id)), want = new Set(userIds);
  const add = [...want].filter((u) => !have.has(u)), remove = [...have].filter((u) => !want.has(u));
  if (add.length) { const { error } = await sb.from('project_members').insert(add.map((user_id) => ({ project_id: projectId, company_id: ctx.companyId, user_id, assigned_by: ctx.userId }))); if (error) return fail(friendlyDbError(error.message)); }
  if (remove.length) { const { error } = await sb.from('project_members').delete().eq('project_id', projectId).in('user_id', remove); if (error) return fail(friendlyDbError(error.message)); }
  revalidatePath(`/projects/${projectId}`); return { ok: true, message: 'Team updated' };
}

export async function saveScopeItem(projectId: string, item: { id?: string; title: string; weight: number; estimatedHours?: number | null; completion?: number }): Promise<ActionResult> {
  const ctx = await getCtx(); const sb = await createClient();
  const row = { title: item.title.trim(), weight: Math.min(100, Math.max(1, Math.round(item.weight))), estimated_hours: item.estimatedHours ?? null,
    ...(item.completion !== undefined ? { completion: Math.min(100, Math.max(0, Math.round(item.completion))) } : {}) };   // admin override (audited by trigger)
  if (row.title.length < 2) return fail('Give the item a title');
  const { error } = item.id
    ? await sb.from('project_scope_items').update(row).eq('id', item.id).eq('project_id', projectId)
    : await sb.from('project_scope_items').insert({ ...row, project_id: projectId, company_id: ctx.companyId });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/projects/${projectId}`); return { ok: true, message: 'Saved' };
}
export async function removeScopeItem(projectId: string, itemId: string): Promise<ActionResult> {
  await getCtx();
  const { error } = await (await createClient()).from('project_scope_items').delete().eq('id', itemId).eq('project_id', projectId);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/projects/${projectId}`); return { ok: true };
}

/** A staff update that names the product. Saved first (so it is never lost), then judged. */
export async function postProjectUpdate(input: { projectId: string; body: string; hours?: number; taskId?: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getCtx();
  const body = input.body.trim();
  if (!uuid.safeParse(input.projectId).success) return fail('Choose the product you worked on');
  if (body.length < 3) return fail('Write what you did');
  if (!(await rateLimit(createAdminClient(), `ai:${ctx.userId}`, 60, 60))) return fail('Slow down a little and try again.');
  const { data, error } = await (await createClient()).from('project_updates').insert({ company_id: ctx.companyId, project_id: input.projectId, user_id: ctx.userId, body,
    hours: input.hours && input.hours > 0 ? input.hours : null, task_id: input.taskId ?? null, source: 'update' }).select('id').single();
  if (error) return fail(/row-level/.test(error.message) ? 'You are not assigned to this product.' : friendlyDbError(error.message));
  await processProjectUpdate(data.id);
  revalidatePath('/projects'); revalidatePath(`/projects/${input.projectId}`); revalidatePath('/dashboard');
  return { ok: true, data: { id: data.id }, message: 'Update recorded' };
}

/** Used by task/unplanned actions when the work is tagged to a product. Best-effort. */
export async function linkWorkToProject(a: { projectId: string; body: string; source: 'task_progress' | 'task_completed' | 'unplanned'; taskId?: string; unplannedId?: string; hours?: number }) {
  try {
    const ctx = await getCtx();
    const { data } = await (await createClient()).from('project_updates').insert({ company_id: ctx.companyId, project_id: a.projectId, user_id: ctx.userId, body: a.body.slice(0, 5000),
      source: a.source, task_id: a.taskId ?? null, unplanned_entry_id: a.unplannedId ?? null, hours: a.hours && a.hours > 0 ? a.hours : null }).select('id').single();
    if (data) await processProjectUpdate(data.id);
  } catch (e) { console.error('[link-project]', (e as Error).message); }
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const ctx = await getCtx(); if (!ctx.roles.includes('admin')) return fail('Only admins can delete products.');
  const { error } = await (await createClient()).from('projects').delete().eq('id', projectId);
  if (error) return fail('This product has tasks or updates linked to it. Mark it cancelled instead.');
  redirect('/projects');
}
