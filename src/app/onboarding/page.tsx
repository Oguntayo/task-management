import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { CompanyOnboardingForm } from '@/components/forms/company-onboarding-form';

export const metadata = { title: 'Create your workspace' };
export default async function Page() {
  const user = await getUser(); if (!user) redirect('/login');
  const { count } = await (await createClient()).from('company_memberships').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active');
  if ((count ?? 0) > 0) redirect('/dashboard');
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-lg border bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Create your company workspace</h1>
        <p className="mb-6 mt-1 text-sm text-muted">You will be its first admin. If you were invited to an existing company, open the link from your invitation email instead.</p>
        <CompanyOnboardingForm />
      </div>
    </main>);
}
