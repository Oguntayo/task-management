/** Mirrors role_permissions seed data in supabase/migrations/0002. The database remains the source of truth; this is for UI + server pre-checks. */
export type Role = 'admin' | 'pm' | 'tech_lead' | 'employee';
export type Permission =
  | 'company.manage' | 'members.manage' | 'tasks.view_all' | 'tasks.create' | 'tasks.approve'
  | 'deadlines.decide' | 'unplanned.review' | 'unplanned.verify' | 'unplanned.admin_approve'
  | 'blockers.manage' | 'reports.team' | 'analytics.company';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ['company.manage', 'members.manage', 'tasks.view_all', 'tasks.create', 'tasks.approve', 'deadlines.decide',
    'unplanned.review', 'unplanned.verify', 'unplanned.admin_approve', 'blockers.manage', 'reports.team', 'analytics.company'],
  pm: ['tasks.view_all', 'tasks.create', 'tasks.approve', 'deadlines.decide', 'unplanned.review', 'blockers.manage', 'reports.team'],
  tech_lead: ['tasks.view_all', 'tasks.create', 'unplanned.verify', 'blockers.manage', 'reports.team'],
  employee: ['tasks.create'],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin', pm: 'Project Manager', tech_lead: 'Technical Lead', employee: 'Employee',
};

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}
export const isManager = (roles: readonly Role[]) => roles.includes('admin') || roles.includes('pm');
export const isLeader = (roles: readonly Role[]) => isManager(roles) || roles.includes('tech_lead');

export interface NavItem { href: string; label: string; icon: string; section: 'work' | 'manage' | 'company'; }

/** Navigation adapts to permissions: users never see links they cannot use. */
export function navFor(roles: readonly Role[]): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Home', icon: 'home', section: 'work' },
    { href: '/tasks', label: 'My tasks', icon: 'list-checks', section: 'work' },
    { href: '/unplanned', label: 'Unplanned work', icon: 'zap', section: 'work' },
    { href: '/planning', label: 'Weekly plan', icon: 'calendar-days', section: 'work' },
    { href: '/reports', label: 'My reports', icon: 'file-text', section: 'work' },
  ];
  if (can(roles, 'tasks.approve') || can(roles, 'deadlines.decide') || can(roles, 'unplanned.review') || can(roles, 'unplanned.verify')) {
    items.push({ href: '/approvals', label: 'Approvals', icon: 'check-circle', section: 'manage' });
  }
  if (can(roles, 'tasks.view_all')) {
    items.push({ href: '/team', label: 'Team tasks', icon: 'users', section: 'manage' });
    items.push({ href: '/blockers', label: 'Blockers', icon: 'octagon-alert', section: 'manage' });
  }
  if (can(roles, 'reports.team')) items.push({ href: '/team/reports', label: 'Team reports', icon: 'clipboard-list', section: 'manage' });
  if (can(roles, 'analytics.company')) items.push({ href: '/analytics', label: 'Analytics', icon: 'bar-chart', section: 'company' });
  if (can(roles, 'members.manage')) items.push({ href: '/settings/people', label: 'People', icon: 'user-cog', section: 'company' });
  if (can(roles, 'company.manage')) items.push({ href: '/settings/company', label: 'Settings', icon: 'settings', section: 'company' });
  return items;
}

/** Which dashboard variants a user may open (a PM who is also a developer gets both). */
export function dashboardsFor(roles: readonly Role[]): Array<'employee' | 'pm' | 'admin'> {
  const out: Array<'employee' | 'pm' | 'admin'> = ['employee'];
  if (isLeader(roles)) out.push('pm');
  if (roles.includes('admin')) out.push('admin');
  return out;
}
