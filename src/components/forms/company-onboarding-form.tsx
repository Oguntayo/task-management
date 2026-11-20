'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/primitives';
import { createCompany } from '@/actions/company';
import type { ActionResult } from '@/lib/utils';

const ZONES = ['Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'UTC'];
export function CompanyOnboardingForm() {
  const [state, action, pending] = useActionState((_: unknown, f: FormData) => createCompany(_, f), null as ActionResult | null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Company name" htmlFor="name" error={fe.name}><Input id="name" name="name" required /></Field>
      <Field label="Industry" hint="optional" htmlFor="industry"><Input id="industry" name="industry" placeholder="Fintech" /></Field>
      <Field label="Timezone" htmlFor="timezone" hint="used for deadlines and reminders"><Select id="timezone" name="timezone" defaultValue="Africa/Lagos">{ZONES.map((z) => <option key={z}>{z}</option>)}</Select></Field>
      {state && !state.ok && !Object.keys(fe).length && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{state.error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>Create workspace</Button>
    </form>);
}
