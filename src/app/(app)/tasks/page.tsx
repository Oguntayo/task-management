import { TasksPage, type TasksSearch } from '@/components/tasks/tasks-page';
export const metadata = { title: 'My tasks' };
export default async function Page({ searchParams }: { searchParams: Promise<TasksSearch> }) { return <TasksPage scope="mine" sp={await searchParams} />; }
