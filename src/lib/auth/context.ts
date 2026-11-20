import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/domain/permissions';
import { isLeader, isManager } from '@/lib/domain/permissions';

export interface CompanySettings {
  reminder_offsets_hours: number[]; remind_on_deadline: boolean; remind_overdue: boolean; overdue_notify_roles: string[];
  require_completion_review: boolean; working_hours_per_day: number; working_days: number[]; retention_days: number | null;
  allow_self_approval?: boolean;
}
export interface Membership { id: string; company_id: string; company: { id: string; name: string; slug: string; timezone: string; status: string; settings: CompanySettings }; roles: Role[]; department_id: string | null; }
export interface Ctx {
  userId: string; email: string; fullName: string; avatarUrl: string | null; isSuperAdmin: boolean;
  memberships: Membership[]; active: Membership; roles: Role[]; companyId: string; tz: string; settings: CompanySettings;
  isManager: boolean; isLeader: boolean;
}
export const ACTIVE_COMPANY_COOKIE = 'wl_company';

export const getUser = cache(async () => {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user;
});

/** Everything the server needs to know about the caller. Authorization still ultimately rests on RLS. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const user = await getUser();
  if (!user) redirect('/login');
  const sb = await createClient();
  const [{ data: profile }, { data: ms }] = await Promise.all([
    sb.from('profiles').select('full_name, email, avatar_url, is_super_admin').eq('id', user.id).single(),
    sb.from('company_memberships')
      .select('id, company_id, department_id, companies(id, name, slug, timezone, status, settings), membership_roles(role_key)')
      .eq('user_id', user.id).eq('status', 'active'),
  ]);
  const memberships: Membership[] = (ms ?? [])
    .filter((m: any) => m.companies && m.companies.status === 'active')
    .map((m: any) => ({ id: m.id, company_id: m.company_id, company: m.companies, department_id: m.department_id,
      roles: m.membership_roles.map((r: any) => r.role_key as Role) }));
  if (memberships.length === 0) {
    if (profile?.is_super_admin) redirect('/platform');
    redirect('/onboarding');
  }
  const wanted = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const active = memberships.find((m) => m.company_id === wanted) ?? memberships[0]!;
  return {
    userId: user.id, email: profile?.email ?? user.email ?? '', fullName: profile?.full_name ?? user.email ?? 'You',
    avatarUrl: profile?.avatar_url ?? null, isSuperAdmin: !!profile?.is_super_admin, memberships, active,
    roles: active.roles, companyId: active.company_id, tz: active.company.timezone, settings: active.company.settings,
    isManager: isManager(active.roles), isLeader: isLeader(active.roles),
  };
});

export async function requireSuperAdmin() {
  const user = await getUser();
  if (!user) redirect('/login');
  const sb = await createClient();
  const { data } = await sb.from('profiles').select('is_super_admin').eq('id', user.id).single();
  if (!data?.is_super_admin) redirect('/dashboard');
  return user;
}
