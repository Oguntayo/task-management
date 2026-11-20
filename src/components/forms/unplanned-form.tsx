'use client';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { FileUpload, type UploadedFile } from '@/components/forms/file-upload';
import { logUnplannedWork, updateUnplannedWork } from '@/actions/unplanned';

export interface Option { id: string; label: string }
const schema = z.object({
  title: z.string().trim().min(3, 'Give it a short title'), whatHappened: z.string().trim().min(5, 'Describe what happened'),
  actionTaken: z.string().trim().min(3, 'Describe what you did'), whyNecessary: z.string().trim().min(3, 'Explain why it was necessary'),
  requestedByName: z.string().optional(), requestedByUserId: z.string().optional(), occurredAt: z.string().min(1, 'When did it happen?'),
  hoursSpent: z.coerce.number().min(0, 'Enter hours').max(168), priority: z.enum(['low', 'medium', 'high', 'urgent']), isUrgent: z.boolean(),
  incidentReference: z.string().optional(), workStatus: z.enum(['completed', 'in_progress', 'awaiting_action']),
  relatedTaskId: z.string().optional(), projectId: z.string().optional(),
});
type V = z.input<typeof schema>;
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function UnplannedForm({ companyId, tasks, members, projects, entryId, initial, onDone }: {
  companyId: string; tasks: Option[]; members: Option[]; projects: Option[]; entryId?: string; initial?: Partial<V>; onDone?: () => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: { priority: 'high', isUrgent: false, workStatus: 'completed', occurredAt: localNow(), hoursSpent: undefined, ...initial } });
  const onSubmit = handleSubmit(async (v) => {
    const payload = { ...v, occurredAt: new Date(v.occurredAt).toISOString(), attachments: files };
    const r = entryId ? await updateUnplannedWork(entryId, payload) : await logUnplannedWork(payload);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? 'Saved'); router.refresh(); onDone?.();
  });
  void watch;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">This is saved as its own record. It never changes your planned tasks, and urgent work does not need approval first. A PM reviews it afterwards.</p>
      <Field label="Title" error={errors.title?.message}><Input {...register('title')} placeholder="Investigate failed customer transaction" /></Field>
      <Field label="What happened?" error={errors.whatHappened?.message}><Textarea {...register('whatHappened')} rows={2} /></Field>
      <Field label="What action did you take?" error={errors.actionTaken?.message}><Textarea {...register('actionTaken')} rows={2} /></Field>
      <Field label="Why was it necessary?" error={errors.whyNecessary?.message}><Textarea {...register('whyNecessary')} rows={2} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Which product?" hint="optional"><Select {...register('projectId')}><option value="">Not product work</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        <Field label="Status" error={errors.workStatus?.message}><Select {...register('workStatus')}><option value="completed">Already completed</option><option value="in_progress">In progress</option><option value="awaiting_action">Still awaiting action</option></Select></Field>
        <Field label="When did it happen?" error={errors.occurredAt?.message}><Input type="datetime-local" {...register('occurredAt')} /></Field>
        <Field label="Time spent (hours)" error={errors.hoursSpent?.message}><Input type="number" step="0.25" min="0" inputMode="decimal" {...register('hoursSpent')} /></Field>
        <Field label="Priority"><Select {...register('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        <Field label="Incident / customer ref" hint="optional"><Input {...register('incidentReference')} placeholder="INC-1042" /></Field>
        <Field label="Requested by" hint="optional"><Select {...register('requestedByUserId')}><option value="">Someone else / not listed</option>{members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
        <Field label="Related planned task" hint="optional"><Select {...register('relatedTaskId')}><option value="">None</option>{tasks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
      </div>
      <Controller control={control} name="isUrgent" render={({ field }) => (
        <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />
          <span><strong>Urgent production work</strong><span className="block text-xs text-muted">Flags it for post-action review and counts as an urgent interruption.</span></span></label>)} />
      {!entryId && <FileUpload companyId={companyId} kind="unplanned" files={files} onChange={setFiles} />}
      <div className="flex justify-end gap-2 pt-1"><Button type="submit" variant="primary" loading={isSubmitting}>{entryId ? 'Save and resubmit' : 'Record unplanned work'}</Button></div>
    </form>);
}
