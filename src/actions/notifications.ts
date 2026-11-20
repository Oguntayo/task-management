'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCtx } from '@/lib/auth/context';
import { NOTIFICATION_LABELS, type NotificationType } from '@/lib/email/templates';
import type { ActionResult } from '@/lib/utils';

export async function markRead(id: string) {
  await getCtx();
  await (await createClient()).from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/notifications');
}
export async function markAllRead() {
  const ctx = await getCtx();
  await (await createClient()).from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.userId).is('read_at', null);
  revalidatePath('/notifications');
}
export async function savePreferences(prefs: Array<{ type: NotificationType; email: boolean; inApp: boolean }>): Promise<ActionResult> {
  const ctx = await getCtx();
  const rows = prefs.filter((p) => p.type in NOTIFICATION_LABELS).map((p) => ({ user_id: ctx.userId, company_id: ctx.companyId, type: p.type, email_enabled: p.email, in_app_enabled: p.inApp, updated_at: new Date().toISOString() }));
  const { error } = await (await createClient()).from('notification_preferences').upsert(rows, { onConflict: 'user_id,company_id,type' });
  if (error) return { ok: false, error: 'Could not save preferences' };
  revalidatePath('/settings/notifications'); return { ok: true, message: 'Preferences saved' };
}
