import { AuthForm } from '@/components/forms/auth-form';
import { resetPassword } from '@/actions/auth';
export default function Page() { return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Choose a new password</h1><p className="mb-6 text-sm text-muted">Use at least 10 characters.</p><AuthForm action={resetPassword} mode="reset" /></>); }
