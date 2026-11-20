'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCtx } from '@/lib/auth/context';
import { notify, taskParticipants, usersWithRoles } from '@/lib/server/notify';
import { blockerSchema, flattenErrors } from '@/lib/validation';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';

export async function reportBlocker(input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  const parsed = blockerSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data;
  const { data, error } = await (await createClient()).from('task_blockers').insert({
    company_id: ctx.companyId, task_id: d.taskId, reported_by: ctx.userId, category: d.category, description: d.description, is_external: d.isExternal,
    responsible_user_id: d.responsibleUserId ?? null, responsible_department_id: d.responsibleDepartmentId ?? null,
    expected_resolution_date: d.expectedResolutionDate ?? null }).select('id').single();
  if (error) return fail(friendlyDbError(error.message));
  const p = await taskParticipants(d.taskId);
  const leads = await usersWithRoles(p.companyId, ['pm', 'tech_lead', 'admin']);
  await notify({ companyId: p.companyId, userIds: [...leads, ...(d.responsibleUserId ? [d.responsibleUserId] : [])], excludeUserId: ctx.userId, type: 'blocker_reported',
    body: `${ctx.fullName} reported a blocker on "${p.title}": ${d.description}`, link: `/tasks/${d.taskId}`, dedupeKey: `blocker:${data.id}` });
  revalidatePath(`/tasks/${d.taskId}`); revalidatePath('/blockers'); revalidatePath('/dashboard');
  return { ok: true, message: 'Blocker reported. The task is now marked blocked.' };
}

export async function resolveBlocker(blockerId: string, note?: string): Promise<ActionResult> {
  const ctx = await getCtx();
  const sb = await createClient();
  const { data, error } = await sb.from('task_blockers').update({ status: 'resolved', resolution_note: note ?? null }).eq('id', blockerId).eq('status', 'open').select('task_id, reported_by').single();
  if (error || !data) return fail(error ? friendlyDbError(error.message) : 'Blocker already resolved or not found');
  const p = await taskParticipants(data.task_id);
  await notify({ companyId: p.companyId, userIds: [data.reported_by, ...p.assignees], excludeUserId: ctx.userId, type: 'blocker_resolved',
    body: `A blocker on "${p.title}" was resolved by ${ctx.fullName}.`, link: `/tasks/${data.task_id}`, dedupeKey: `blocker_resolved:${blockerId}` });
  revalidatePath(`/tasks/${data.task_id}`); revalidatePath('/blockers'); return { ok: true, message: 'Blocker resolved' };
}
