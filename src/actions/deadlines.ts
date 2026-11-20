'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCtx } from '@/lib/auth/context';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { evaluateExtension } from '@/lib/ai';
import { buildExtensionInput } from '@/lib/server/ai-context';
import { notify, taskParticipants, usersWithRoles } from '@/lib/server/notify';
import { extensionSchema, flattenErrors } from '@/lib/validation';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';

export async function requestExtension(input: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  const parsed = extensionSchema.safeParse(input);
  if (!parsed.success) return fail('Please fix the highlighted fields', flattenErrors(parsed.error));
  const d = parsed.data, sb = await createClient();
  const { data: reqId, error } = await sb.rpc('request_deadline_extension', { p_task_id: d.taskId, p_requested_deadline: new Date(d.requestedDeadline).toISOString(), p_reason: d.reason });
  if (error) return fail(friendlyDbError(error.message));
  const admin = createAdminClient();
  // AI evaluation is advisory and best-effort; the PM can always decide without it.
  try {
    if (await rateLimit(admin, `ai:${ctx.userId}`, LIMITS.ai.limit, LIMITS.ai.window)) {
      const r = await evaluateExtension(await buildExtensionInput(reqId as string, ctx.settings));
      await admin.from('ai_recommendations').insert({ company_id: ctx.companyId, kind: 'deadline_extension', task_id: d.taskId, deadline_request_id: reqId,
        verdict: r.verdict, recommendation: r.recommendation, factors: { items: r.factors, source: r.source }, used_company_history: r.usedCompanyHistory,
        provider: r.source === 'ai' ? r.provider : 'heuristic', model: r.model ?? null });
    }
  } catch (e) { console.error('[ai-ext]', (e as Error).message); }
  const p = await taskParticipants(d.taskId);
  await notify({ companyId: p.companyId, userIds: await usersWithRoles(p.companyId, ['pm', 'admin']), excludeUserId: ctx.userId, type: 'extension_requested',
    body: `${ctx.fullName} requested more time on "${p.title}".`, link: `/tasks/${d.taskId}`, dedupeKey: `ext_req:${reqId}`,
    details: [['Requested deadline', new Date(d.requestedDeadline).toLocaleString()], ['Reason', d.reason]] });
  revalidatePath(`/tasks/${d.taskId}`); revalidatePath('/approvals'); return { ok: true, message: 'Extension requested' };
}

export async function decideExtension(input: { requestId: string; decision: 'approved' | 'rejected' | 'clarification_requested'; note?: string }): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx.isManager) return fail('Only a PM or admin can decide on extensions.');
  const sb = await createClient();
  const { data: r } = await sb.from('task_deadline_change_requests').select('task_id, requested_by').eq('id', input.requestId).single();
  const { error } = await sb.rpc('decide_deadline_request', { p_request_id: input.requestId, p_decision: input.decision, p_note: input.note ?? null });
  if (error) return fail(friendlyDbError(error.message));
  if (r) {
    const p = await taskParticipants(r.task_id);
    const word = { approved: 'approved', rejected: 'rejected', clarification_requested: 'asked for clarification on' }[input.decision];
    await notify({ companyId: p.companyId, userIds: [r.requested_by, ...p.assignees], excludeUserId: ctx.userId,
      type: input.decision === 'approved' ? 'extension_approved' : input.decision === 'rejected' ? 'extension_rejected' : 'extension_clarification',
      body: `${ctx.fullName} ${word} your extension request for "${p.title}".${input.note ? ` Note: ${input.note}` : ''}`, link: `/tasks/${r.task_id}`,
      dedupeKey: `ext_decision:${input.requestId}:${input.decision}` });
    revalidatePath(`/tasks/${r.task_id}`);
  }
  revalidatePath('/approvals'); return { ok: true, message: 'Decision recorded' };
}

export async function respondToClarification(requestId: string, response: string): Promise<ActionResult> {
  await getCtx();
  if (response.trim().length < 3) return fail('Add a response');
  const { error } = await (await createClient()).rpc('respond_deadline_clarification', { p_request_id: requestId, p_response: response.trim() });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/approvals'); return { ok: true, message: 'Response sent' };
}

export async function withdrawExtension(requestId: string): Promise<ActionResult> {
  await getCtx();
  const { error } = await (await createClient()).rpc('withdraw_deadline_request', { p_request_id: requestId });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/approvals'); return { ok: true };
}
