'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCtx } from '@/lib/auth/context';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { evaluateEstimate } from '@/lib/ai';
import { buildEstimateInput } from '@/lib/server/ai-context';
import { notify, taskParticipants, usersWithRoles } from '@/lib/server/notify';
import { flattenErrors, progressSchema, taskSchema } from '@/lib/validation';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';
import { canTransition, type TaskStatus } from '@/lib/domain/task-state';
import { isOwnCloudinaryAsset } from '@/lib/cloudinary';
import { linkWorkToProject } from '@/actions/projects';

/** Run AI estimation (advisory) and notify approvers. Never throws: AI failure must not block submission. */
async function runEstimateAndNotify(taskId: string) {
  const ctx = await getCtx();
  const admin = createAdminClient();
  const { data: t } = await admin.from('tasks').select('*, task_categories(name), task_assignees(user_id)').eq('id', taskId).single();
  if (!t) return;
  const { data: deps } = await admin.from('task_dependencies').select('depends:tasks!task_dependencies_depends_on_task_id_fkey(title)').eq('task_id', taskId);
  try {
    if (await rateLimit(admin, `ai:${ctx.userId}`, LIMITS.ai.limit, LIMITS.ai.window)) {
      const input = await buildEstimateInput({ companyId: t.company_id, userId: ctx.userId, settings: ctx.settings, tz: ctx.tz,
        task: { title: t.title, description: t.description, categoryId: t.category_id, categoryName: (t.task_categories as any)?.name ?? null,
          expectedDeliverable: t.expected_deliverable, estimatedHours: t.estimated_hours, startDate: t.expected_start_date, deadline: t.current_deadline,
          dependencyTitles: (deps ?? []).map((d: any) => d.depends?.title).filter(Boolean) } });
      const r = await evaluateEstimate(input);
      await admin.from('ai_task_estimates').insert({ company_id: t.company_id, task_id: t.id, requested_by: ctx.userId,
        employee_estimate_hours: t.estimated_hours, recommended_min_hours: r.recommendedMinHours, recommended_max_hours: r.recommendedMaxHours,
        verdict: r.verdict, explanation: r.explanation, missing_information: r.missingInformation, used_company_history: r.usedCompanyHistory,
        provider: r.source === 'ai' ? r.provider : 'heuristic', model: r.model ?? null, raw_response: r });
      await admin.from('tasks').update({ ai_suggested_hours: Math.round(((r.recommendedMinHours + r.recommendedMaxHours) / 2) * 10) / 10 }).eq('id', t.id);
    }
  } catch (e) { console.error('[estimate]', (e as Error).message); }
  const approvers = await usersWithRoles(t.company_id, ['pm', 'admin']);
  await notify({ companyId: t.company_id, userIds: approvers, excludeUserId: t.creator_id, type: 'task_submitted',
    body: `${ctx.fullName} submitted "${t.title}" for approval.`, link: `/tasks/${t.id}`, dedupeKey: `task_submitted:${t.id}:${Date.now()}`,
    details: [['Estimate', `${t.estimated_hours}h`], ['Deadline', new Date(t.current_deadline).toLocaleString()]] });
}

export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await getCtx();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data;
  if (d.periodStart && d.periodEnd && d.periodEnd < d.periodStart) return fail('Period end must be after period start');
  const sb = await createClient();
  const { data: task, error } = await sb.from('tasks').insert({
    company_id: ctx.companyId, title: d.title, description: d.description, category_id: d.categoryId ?? null, project_id: d.projectId ?? null,
    department_id: d.departmentId ?? ctx.active.department_id, creator_id: ctx.userId, priority: d.priority,
    planning_period: d.planningPeriod, period_start: d.periodStart ?? null, period_end: d.periodEnd ?? null,
    expected_start_date: d.expectedStartDate ?? null, original_deadline: new Date(d.deadline).toISOString(),
    estimated_hours: d.estimatedHours, expected_deliverable: d.expectedDeliverable ?? null, complexity: d.complexity ?? null,
    task_type: d.periodStart ? 'planned' : 'ad_hoc', status: d.submit ? 'pending_approval' : 'draft' }).select('id').single();
  if (error) return fail(friendlyDbError(error.message));
  const assignees = d.assigneeIds.length ? d.assigneeIds : [ctx.userId];
  const { error: aErr } = await sb.from('task_assignees').insert(assignees.map((user_id) => ({ task_id: task.id, company_id: ctx.companyId, user_id })));
  if (aErr) return fail(friendlyDbError(aErr.message));
  if (d.dependencyIds.length) await sb.from('task_dependencies').insert(d.dependencyIds.map((x) => ({ task_id: task.id, depends_on_task_id: x, company_id: ctx.companyId })));
  if (d.submit) after(async () => {
    try { await runEstimateAndNotify(task.id); }
    catch (e) { console.error('[task-submit]', (e as Error).message); }
  });
  revalidatePath('/tasks'); revalidatePath('/dashboard');
  return { ok: true, data: { id: task.id }, message: d.submit ? 'Submitted for approval' : 'Draft saved' };
}

export async function updateDraftTask(taskId: string, input: unknown): Promise<ActionResult> {
  await getCtx();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data, sb = await createClient();
  const { data: cur } = await sb.from('tasks').select('status').eq('id', taskId).single();
  if (!cur || cur.status !== 'draft') return fail('Only drafts can be edited. Ask your PM to return the task if it needs changes.');
  const { error } = await sb.from('tasks').update({
    title: d.title, description: d.description, category_id: d.categoryId ?? null, priority: d.priority, planning_period: d.planningPeriod,
    period_start: d.periodStart ?? null, period_end: d.periodEnd ?? null, expected_start_date: d.expectedStartDate ?? null,
    original_deadline: new Date(d.deadline).toISOString(), estimated_hours: d.estimatedHours, expected_deliverable: d.expectedDeliverable ?? null,
    complexity: d.complexity ?? null }).eq('id', taskId);
  if (error) return fail(friendlyDbError(error.message));
  if (d.submit) { const r = await submitTask(taskId); if (!r.ok) return r; }
  revalidatePath(`/tasks/${taskId}`); return { ok: true, message: 'Saved' };
}

export async function submitTask(taskId: string): Promise<ActionResult> {
  await getCtx();
  const { data, error } = await (await createClient()).from('tasks').update({ status: 'pending_approval' }).eq('id', taskId).eq('status', 'draft').select('id');
  if (error) return fail(friendlyDbError(error.message));
  if (!data?.length) return fail('Task is not a draft or you cannot submit it.');
  after(async () => {
    try { await runEstimateAndNotify(taskId); }
    catch (e) { console.error('[task-submit]', (e as Error).message); }
  });
  revalidatePath(`/tasks/${taskId}`); revalidatePath('/tasks'); return { ok: true, message: 'Submitted for approval' };
}

export async function decideTask(input: { taskId: string; decision: 'approved' | 'rejected' | 'clarification_requested' | 'revision_requested' | 'priority_change_suggested'; note?: string; suggestedPriority?: string; suggestedDeadline?: string }): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx.isManager) return fail('Only a PM or admin can decide on tasks.');
  const { error } = await (await createClient()).rpc('decide_task_approval', { p_task_id: input.taskId, p_decision: input.decision, p_note: input.note ?? null,
    p_suggested_priority: input.suggestedPriority ?? null, p_suggested_deadline: input.suggestedDeadline ? new Date(input.suggestedDeadline).toISOString() : null });
  if (error) return fail(friendlyDbError(error.message));
  const p = await taskParticipants(input.taskId);
  const typeBy = { approved: 'task_approved', rejected: 'task_rejected', clarification_requested: 'task_clarification', revision_requested: 'task_clarification', priority_change_suggested: 'task_clarification' } as const;
  const verb = { approved: 'approved', rejected: 'rejected', clarification_requested: 'asked for clarification on', revision_requested: 'asked for a revised timeline on', priority_change_suggested: 'suggested a priority change for' }[input.decision];
  await notify({ companyId: p.companyId, userIds: [p.creator, ...p.assignees], excludeUserId: ctx.userId, type: typeBy[input.decision],
    body: `${ctx.fullName} ${verb} "${p.title}".${input.note ? ` Note: ${input.note}` : ''}`, link: `/tasks/${input.taskId}`, dedupeKey: `task_decision:${input.taskId}:${input.decision}:${Date.now()}` });
  revalidatePath('/approvals'); revalidatePath(`/tasks/${input.taskId}`); return { ok: true, message: 'Decision recorded' };
}

export async function changeTaskStatus(taskId: string, to: TaskStatus): Promise<ActionResult> {
  const ctx = await getCtx();
  const sb = await createClient();
  const { data: t } = await sb.from('tasks').select('status').eq('id', taskId).single();
  if (!t) return fail('Task not found');
  if (!canTransition(t.status as TaskStatus, to)) return fail(`A task cannot move from ${t.status} to ${to}.`);
  const { error } = await sb.from('tasks').update({ status: to }).eq('id', taskId);
  if (error) return fail(friendlyDbError(error.message));
  if (to === 'completed') {
    const { data: tk } = await sb.from('tasks').select('project_id, title, expected_deliverable').eq('id', taskId).single();
    if (tk?.project_id) await linkWorkToProject({ projectId: tk.project_id, source: 'task_completed', taskId, body: `Completed task: ${tk.title}${tk.expected_deliverable ? ` (deliverable: ${tk.expected_deliverable})` : ''}` });
  }
  if (to === 'under_review') {
    const p = await taskParticipants(taskId);
    await notify({ companyId: p.companyId, userIds: await usersWithRoles(p.companyId, ['pm', 'tech_lead', 'admin']), excludeUserId: ctx.userId, type: 'task_submitted',
      title: 'Completed work needs review', body: `${ctx.fullName} submitted "${p.title}" for completion review.`, link: `/tasks/${taskId}`, dedupeKey: `review:${taskId}:${Date.now()}` });
  }
  revalidatePath(`/tasks/${taskId}`); revalidatePath('/tasks'); revalidatePath('/dashboard'); return { ok: true };
}

export async function updateProgress(input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) return fail('Invalid progress', flattenErrors(parsed.error));
  const d = parsed.data, sb = await createClient();
  const { error } = await sb.from('tasks').update({ progress: d.progress }).eq('id', d.taskId);
  if (error) return fail(friendlyDbError(error.message));
  if (d.hours && d.hours > 0) {
    const { error: e2 } = await sb.from('task_time_logs').insert({ company_id: ctx.companyId, task_id: d.taskId, user_id: ctx.userId, hours: d.hours, note: d.note ?? null });
    if (e2) return fail('Progress saved, but you can only log time on tasks assigned to you.');
  }
  const { data: tk } = await sb.from('tasks').select('project_id, title').eq('id', d.taskId).single();
  if (tk?.project_id && (d.note || (d.hours ?? 0) > 0)) await linkWorkToProject({ projectId: tk.project_id, source: 'task_progress', taskId: d.taskId, hours: d.hours,
    body: `${tk.title} — now ${d.progress}% complete${d.note ? `: ${d.note}` : ''}` });
  if (d.note) await sb.from('task_comments').insert({ company_id: ctx.companyId, task_id: d.taskId, author_id: ctx.userId, body: `Progress update (${d.progress}%): ${d.note}` });
  revalidatePath(`/tasks/${d.taskId}`); revalidatePath('/dashboard'); return { ok: true, message: 'Progress updated' };
}

export async function addComment(taskId: string, body: string, kind: 'task' | 'unplanned' = 'task'): Promise<ActionResult> {
  const ctx = await getCtx();
  const text = body.trim(); if (!text) return fail('Write a comment first');
  const { error } = await (await createClient()).from('task_comments').insert({ company_id: ctx.companyId, author_id: ctx.userId, body: text,
    ...(kind === 'task' ? { task_id: taskId } : { unplanned_entry_id: taskId }) });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(kind === 'task' ? `/tasks/${taskId}` : `/unplanned/${taskId}`); return { ok: true };
}

export async function recordAttachment(a: { taskId: string; publicId: string; url: string; resourceType: string; format?: string; bytes?: number; name?: string }): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!isOwnCloudinaryAsset(a.publicId, ctx.companyId)) return fail('Invalid attachment');
  const { error } = await (await createClient()).from('task_attachments').insert({ company_id: ctx.companyId, task_id: a.taskId, uploaded_by: ctx.userId,
    cloudinary_public_id: a.publicId, cloudinary_url: a.url, resource_type: a.resourceType, format: a.format ?? null, bytes: a.bytes ?? null, original_filename: a.name ?? null });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath(`/tasks/${a.taskId}`); return { ok: true };
}
