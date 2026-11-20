'use client';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { createTask } from '@/actions/tasks';
import type { Option } from '@/components/forms/unplanned-form';

const schema = z.object({
  title: z.string().trim().min(3, 'Give the task a clear title'), description: z.string().trim().min(10, 'Describe the work (at least a sentence)'),
  categoryId: z.string().optional(), projectId: z.string().optional(), departmentId: z.string().optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']),
  planningPeriod: z.enum(['daily', 'weekly', 'custom']), periodStart: z.string().optional(), periodEnd: z.string().optional(),
  expectedStartDate: z.string().optional(), deadline: z.string().min(1, 'Set a deadline'), estimatedHours: z.coerce.number().positive('Enter your estimate in hours'),
  expectedDeliverable: z.string().optional(), complexity: z.string().optional(), assigneeIds: z.array(z.string()),
});
type V = z.input<typeof schema>;

export function TaskForm({ categories, departments, projects, people, canAssign, weekStart, weekEnd, defaultProjectId }: {
  categories: Option[]; departments: Option[]; projects: Option[]; people: Option[]; canAssign: boolean; weekStart: string; weekEnd: string; defaultProjectId?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<V>({
    resolver: zodResolver(schema), defaultValues: { priority: 'medium', planningPeriod: 'weekly', periodStart: weekStart, periodEnd: weekEnd, assigneeIds: [], projectId: defaultProjectId ?? '' } });
  const period = watch('planningPeriod');
  const submit = (asDraft: boolean) => handleSubmit(async (v) => {
    if (saving) return;
    setSaving(asDraft ? 'draft' : 'submit');
    const payload = { ...v, deadline: new Date(v.deadline).toISOString(), complexity: v.complexity ? Number(v.complexity) : undefined, submit: !asDraft,
      periodStart: period === 'custom' || period === 'weekly' || period === 'daily' ? v.periodStart : undefined };
    try {
      const r = await createTask(payload);
      if (!r.ok) { setSaving(null); return toast.error(r.error); }
      toast.success(r.message ?? 'Saved');
      const href = `/tasks/${r.data!.id}`;
      window.dispatchEvent(new CustomEvent('workline:navigation-start', { detail: href }));
      router.push(href);
    } catch {
      setSaving(null);
      toast.error('Something went wrong. Please try again.');
    }
  });
  return (
    <form className="space-y-5" noValidate onSubmit={submit(false)}>
      <Field label="Title" error={errors.title?.message}><Input {...register('title')} placeholder="Integrate payment gateway" autoFocus /></Field>
      <Field label="Description" error={errors.description?.message}><Textarea rows={4} {...register('description')} placeholder="What will be done, and what does done look like?" /></Field>
      <Field label="Expected deliverable" hint="helps your PM and the AI judge scope"><Input {...register('expectedDeliverable')} placeholder="Deployed endpoint with tests" /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Product" hint="optional"><Select {...register('projectId')}><option value="">Not product work</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Category"><Select {...register('categoryId')}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Priority"><Select {...register('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        <Field label="Planning period"><Select {...register('planningPeriod')}><option value="daily">Daily commitment</option><option value="weekly">Weekly commitment</option><option value="custom">Custom range</option></Select></Field>
        <Field label="Period starts"><Input type="date" {...register('periodStart')} /></Field>
        <Field label="Period ends"><Input type="date" {...register('periodEnd')} /></Field>
        <Field label="Expected start"><Input type="date" {...register('expectedStartDate')} /></Field>
        <Field label="Deadline" error={errors.deadline?.message}><Input type="datetime-local" {...register('deadline')} /></Field>
        <Field label="Your estimate (hours)" error={errors.estimatedHours?.message}><Input type="number" step="0.5" min="0" inputMode="decimal" {...register('estimatedHours')} /></Field>
        <Field label="Complexity" hint="1 easy – 5 hard"><Select {...register('complexity')}><option value="">Not set</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></Field>
        {departments.length > 0 && <Field label="Department"><Select {...register('departmentId')}><option value="">Mine</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select></Field>}
      </div>
      {canAssign && (<Controller control={control} name="assigneeIds" render={({ field }) => (
        <fieldset><legend className="mb-1 text-xs font-medium">Assign to <span className="font-normal text-subtle">(defaults to you)</span></legend>
          <div className="flex flex-wrap gap-2">{people.map((p) => { const on = field.value.includes(p.id);
            return <label key={p.id} className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs ${on ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'text-muted hover:bg-surface-2'}`}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => field.onChange(on ? field.value.filter((x) => x !== p.id) : [...field.value, p.id])} />{p.label}</label>; })}</div></fieldset>)} />)}
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">When you submit, an AI check compares your estimate with the scope, your workload and any company history. It is advice for your PM, who makes the decision. Once approved, the deadline is locked; changes go through an extension request.</p>
      <div className="flex justify-end gap-2"><Button type="button" onClick={submit(true)} disabled={isSubmitting || saving !== null} loading={saving === 'draft'}>Save draft</Button><Button type="submit" variant="primary" disabled={saving !== null} loading={isSubmitting || saving === 'submit'}>{saving === 'submit' ? 'Submitting…' : 'Submit for approval'}</Button></div>
    </form>);
}
