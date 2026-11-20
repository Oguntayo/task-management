import { redirect } from 'next/navigation';
import { getCtx } from '@/lib/auth/context';
import { can } from '@/lib/domain/permissions';
import { TasksPage, type TasksSearch } from '@/components/tasks/tasks-page';
export const metadata = { title: 'Team tasks' };
export default async function Page({ searchParams }: { searchParams: Promise<TasksSearch> }) {
  const ctx = await getCtx(); if (!can(ctx.roles, 'tasks.view_all')) redirect('/tasks');
  return <TasksPage scope="team" sp={await searchParams} />;
}
