import { AuthForm } from '@/components/forms/auth-form';
import { register } from '@/actions/auth';
export const metadata = { title: 'Create account' };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Create your account</h1><p className="mb-6 text-sm text-muted">You will set up your company workspace next.</p><AuthForm action={register} mode="register" next={next} /></>);
}
