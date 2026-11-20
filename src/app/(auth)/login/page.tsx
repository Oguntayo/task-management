import { AuthForm } from '@/components/forms/auth-form';
import { login } from '@/actions/auth';
export const metadata = { title: 'Sign in' };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Welcome back</h1><p className="mb-6 text-sm text-muted">Sign in to your workspace.</p><AuthForm action={login} mode="login" next={next} /></>);
}
