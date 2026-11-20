import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/domain/permissions';
import type { TaskStatus } from '@/lib/domain/task-state';

export interface Member { id: string; name: string; avatar: string | null; roles: Role[]; departmentId: string | null; membershipId: string; }
export async function getMembers(sb: SupabaseClient, companyId: string): Promise<Member[]> {
  const { data } = await sb.from('company_memberships').select('id, user_id, department_id, profiles(full_name, avatar_url), membership_roles(role_key)').eq('company_id', companyId).eq('status', 'active');
  return (data ?? []).map((m: any) => ({ id: m.user_id, membershipId: m.id, name: m.profiles?.full_name ?? 'Unknown', avatar: m.profiles?.avatar_url ?? null, departmentId: m.department_id, roles: m.membership_roles.map((r: any) => r.role_key) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export const memberMap = (m: Member[]) => new Map(m.map((x) => [x.id, x]));

export interface TaskRow {
  id: string; title: string; status: TaskStatus; priority: string; progress: number; task_type: string; creator_id: string; department_id: string | null; project_id: string | null;
  original_deadline: string | null; current_deadline: string | null; estimated_hours: number | null; ai_suggested_hours: number | null; category_id: string | null; created_at: string; completed_at: string | null;
  projects: { name: string } | null; task_assignees: Array<{ user_id: string }>; task_categories: { name: string } | null;
}
export const TASK_COLS = 'id, title, status, priority, progress, task_type, creator_id, department_id, project_id, original_deadline, current_deadline, estimated_hours, ai_suggested_hours, category_id, created_at, completed_at, projects(name), task_assignees(user_id), task_categories(name)';

export interface TaskFilters { q?: string; status?: string; priority?: string; assignee?: string; department?: string; project?: string; from?: string; to?: string; kind?: string; }
export async function getTasks(sb: SupabaseClient, companyId: string, f: TaskFilters, opts: { mineUserId?: string; limit?: number } = {}): Promise<TaskRow[]> {
  const select = opts.mineUserId ? TASK_COLS.replace('task_assignees(user_id)', 'task_assignees!inner(user_id)') : TASK_COLS;
  let q = sb.from('tasks').select(select).eq('company_id', companyId).order('current_deadline', { ascending: true, nullsFirst: false }).limit(opts.limit ?? 300);
  if (opts.mineUserId) q = q.eq('task_assignees.user_id', opts.mineUserId);
  if (f.status && f.status !== 'all') q = f.status === 'open' ? q.in('status', ['pending_approval', 'approved', 'in_progress', 'blocked', 'under_review']) : q.eq('status', f.status);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.department) q = q.eq('department_id', f.department);
  if (f.project) q = q.eq('project_id', f.project);
  if (f.from) q = q.gte('current_deadline', f.from);
  if (f.to) q = q.lte('current_deadline', `${f.to}T23:59:59Z`);
  if (f.q) q = q.ilike('title', `%${f.q.replace(/[%_]/g, '')}%`);
  const { data } = await q;
  let rows = (data ?? []) as unknown as TaskRow[];
  if (f.assignee && !opts.mineUserId) rows = rows.filter((t) => t.task_assignees.some((a) => a.user_id === f.assignee));
  return rows;
}

export interface UnplannedRow { id: string; user_id: string; title: string; occurred_at: string; hours_spent: number; is_urgent: boolean; priority: string; work_status: string; review_status: string; incident_reference: string | null; project_id: string | null; verified_by: string | null; admin_approved_by: string | null; projects: { name: string } | null; }
export const UNPLANNED_COLS = 'id, user_id, title, occurred_at, hours_spent, is_urgent, priority, work_status, review_status, incident_reference, project_id, verified_by, admin_approved_by, projects(name)';

export const fmtDate = (iso: string | null | undefined, tz: string, withTime = false) => !iso ? '—' :
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(iso));
export const isOverdue = (t: Pick<TaskRow, 'status' | 'current_deadline'>) =>
  !!t.current_deadline && ['approved', 'in_progress', 'blocked', 'under_review'].includes(t.status) && new Date(t.current_deadline) < new Date();
