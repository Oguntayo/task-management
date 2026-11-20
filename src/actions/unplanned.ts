'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCtx } from '@/lib/auth/context';
import { notify, usersWithRoles } from '@/lib/server/notify';
import { flattenErrors, unplannedSchema } from '@/lib/validation';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';
import { isOwnCloudinaryAsset } from '@/lib/cloudinary';
import { linkWorkToProject } from '@/actions/projects';

const row = (ctx: Awaited<ReturnType<typeof getCtx>>, d: ReturnType<typeof unplannedSchema.parse>) => ({
  company_id: ctx.companyId, user_id: ctx.userId, title: d.title, what_happened: d.whatHappened, action_taken: d.actionTaken, why_necessary: d.whyNecessary,
  requested_by_name: d.requestedByName ?? null, requested_by_user_id: d.requestedByUserId ?? null, occurred_at: new Date(d.occurredAt).toISOString(),
  hours_spent: d.hoursSpent, priority: d.priority, is_urgent: d.isUrgent, incident_reference: d.incidentReference ?? null, work_status: d.workStatus,
  related_task_id: d.relatedTaskId ?? null, project_id: d.projectId ?? null, category_id: d.categoryId ?? null });

/** Urgent work is recorded immediately; review happens afterwards. Nothing here waits for approval. */
export async function logUnplannedWork(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await getCtx();
  const parsed = unplannedSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data, sb = await createClient();
  const { data, error } = await sb.from('unplanned_work_entries').insert(row(ctx, d)).select('id').single();
  if (error) return fail(friendlyDbError(error.message));
  for (const a of d.attachments) {
    if (!isOwnCloudinaryAsset(a.publicId, ctx.companyId)) continue;
    await sb.from('task_attachments').insert({ company_id: ctx.companyId, unplanned_entry_id: data.id, uploaded_by: ctx.userId, cloudinary_public_id: a.publicId,
      cloudinary_url: a.url, resource_type: a.resourceType, format: a.format ?? null, bytes: a.bytes ?? null, original_filename: a.name ?? null });
  }
  if (d.projectId && d.workStatus !== 'awaiting_action') await linkWorkToProject({ projectId: d.projectId, source: 'unplanned', unplannedId: data.id, hours: d.hoursSpent, body: `${d.title}: ${d.actionTaken}` });
  const reviewers = await usersWithRoles(ctx.companyId, ['pm', 'admin']);
  await notify({ companyId: ctx.companyId, userIds: reviewers, excludeUserId: ctx.userId, type: d.isUrgent ? 'unplanned_review_needed' : 'unplanned_submitted',
    title: d.isUrgent ? 'Urgent unplanned work logged: review needed' : 'Unplanned work logged',
    body: `${ctx.fullName} logged ${d.hoursSpent}h of ${d.isUrgent ? 'urgent ' : ''}unplanned work: "${d.title}" (${d.workStatus.replace('_', ' ')}).`,
    link: `/unplanned/${data.id}`, dedupeKey: `unplanned:${data.id}`, details: d.incidentReference ? [['Incident', d.incidentReference]] : undefined });
  revalidatePath('/unplanned'); revalidatePath('/dashboard'); revalidatePath('/approvals');
  return { ok: true, data: { id: data.id }, message: 'Unplanned work recorded. Your planned tasks were not changed.' };
}

export async function updateUnplannedWork(id: string, input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  const parsed = unplannedSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const { company_id, user_id, ...patch } = row(ctx, parsed.data); void company_id; void user_id;
  const { error } = await (await createClient()).from('unplanned_work_entries').update(patch).eq('id', id);
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/unplanned/${id}`); revalidatePath('/unplanned'); return { ok: true, message: 'Updated' };
}

export async function reviewUnplannedWork(id: string, action: 'approve' | 'reject' | 'request_clarification' | 'needs_further_review' | 'verify' | 'admin_approve', note?: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const sb = await createClient();
  const { data: e } = await sb.from('unplanned_work_entries').select('user_id, title').eq('id', id).single();
  const { error } = await sb.rpc('review_unplanned_entry', { p_entry_id: id, p_action: action, p_note: note ?? null });
  if (error) return fail(friendlyDbError(error.message));
  if (e) await notify({ companyId: ctx.companyId, userIds: [e.user_id], excludeUserId: ctx.userId, type: 'unplanned_decided',
    body: `${ctx.fullName}: ${action.replace(/_/g, ' ')} on "${e.title}".${note ? ` Note: ${note}` : ''}`, link: `/unplanned/${id}`, dedupeKey: `unplanned_review:${id}:${action}:${Date.now()}` });
  revalidatePath(`/unplanned/${id}`); revalidatePath('/approvals'); return { ok: true, message: 'Recorded' };
}
