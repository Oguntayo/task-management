'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/auth/context';
import { fail, friendlyDbError, type ActionResult } from '@/lib/utils';

/** Platform-level only: counts and company status. The super admin never sees tenant task content (enforced by RLS, not just the UI). */
export async function setCompanyStatus(companyId: string, status: 'active' | 'suspended'): Promise<ActionResult> {
  await requireSuperAdmin();
  const { error } = await (await createClient()).rpc('platform_set_company_status', { p_company: companyId, p_status: status });
  if (error) return fail(friendlyDbError(error.message));
  revalidatePath('/platform');
  return { ok: true, message: status === 'suspended' ? 'Company suspended' : 'Company reactivated' };
}
