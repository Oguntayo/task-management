import { AuthForm } from '@/components/forms/auth-form';
import { forgotPassword } from '@/actions/auth';
export default function Page() { return (<><h1 className="mb-1 text-xl font-semibold tracking-tight">Reset your password</h1><p className="mb-6 text-sm text-muted">We will email you a link.</p><AuthForm action={forgotPassword} mode="forgot" /></>); }
