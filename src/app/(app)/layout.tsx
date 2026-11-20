import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getCtx } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { navFor, ROLE_LABELS, can } from '@/lib/domain/permissions';
import { Sidebar } from '@/components/shell/sidebar';
import { ThemeToggle, UserMenu } from '@/components/shell/user-menu';
import { QuickActions, type QuickData } from '@/components/shell/quick-actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const sb = await createClient();
  const wantsReview = can(ctx.roles, 'tasks.approve') || can(ctx.roles, 'deadlines.decide') || can(ctx.roles, 'unplanned.review');
  const [{ count: unread }, { data: myTasks }, { data: members }, { data: projects }, pendingTasks, pendingExt, pendingUnplanned] = await Promise.all([
    sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).is('read_at', null),
    sb.from('tasks').select('id, title, task_assignees!inner(user_id)').eq('company_id', ctx.companyId).eq('task_assignees.user_id', ctx.userId).in('status', ['approved', 'in_progress', 'blocked', 'under_review']).limit(50),
    sb.from('company_memberships').select('user_id, profiles(full_name)').eq('company_id', ctx.companyId).eq('status', 'active'),
    sb.from('projects').select('id, name').eq('company_id', ctx.companyId).in('status', ['planning', 'active']).order('name'),
    wantsReview ? sb.from('tasks').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).in('status', ['submitted', 'pending_approval']) : { count: 0 },
    wantsReview ? sb.from('task_deadline_change_requests').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('status', 'pending') : { count: 0 },
    wantsReview ? sb.from('unplanned_work_entries').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('review_status', 'reported') : { count: 0 },
  ]);
  // Staff only see products they are assigned to (RLS); leaders see all, so "projects" is already correctly scoped.
  const quick: QuickData = { companyId: ctx.companyId,
    tasks: (myTasks ?? []).map((t) => ({ id: t.id, label: t.title })),
    members: (members ?? []).filter((m: any) => m.user_id !== ctx.userId).map((m: any) => ({ id: m.user_id, label: m.profiles?.full_name ?? 'Unknown' })),
    projects: (projects ?? []).map((p) => ({ id: p.id, label: p.name })) };
  const items = navFor(ctx.roles);
  items.splice(3, 0, { href: '/projects', label: 'Products', icon: 'folder', section: 'work' });
  const badges = { '/approvals': (pendingTasks.count ?? 0) + (pendingExt.count ?? 0) + (pendingUnplanned.count ?? 0) };
  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} companyName={ctx.active.company.name} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-end gap-2 border-b bg-bg/85 px-4 pl-14 backdrop-blur md:pl-6">
          <div className="hidden sm:block"><QuickActions data={quick} variant="header" /></div>
          <Link href="/notifications" className="relative rounded-md p-1.5 text-muted hover:bg-surface-2" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
            <Bell className="size-4" />{!!unread && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-urgent" />}</Link>
          <ThemeToggle />
          <UserMenu name={ctx.fullName} email={ctx.email} avatarUrl={ctx.avatarUrl} activeId={ctx.companyId} roles={ctx.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
            companies={ctx.memberships.map((m) => ({ id: m.company_id, name: m.company.name }))} />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pb-10">{children}</main>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface/95 p-3 backdrop-blur sm:hidden"><QuickActions data={quick} variant="bar" /></div>
      </div>
    </div>);
}
