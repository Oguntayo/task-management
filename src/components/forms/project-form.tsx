'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { createProject } from '@/actions/projects';
import type { Option } from '@/components/forms/unplanned-form';

interface DraftItem { title: string; estimatedHours: string }

/** New product. The admin sketches the name, what it is, who's on it and (optionally) rough scope; the AI proposes an ETA once it exists. */
export function ProjectForm({ people }: { people: Option[] }) {
  const { run, pending, fieldErrors } = useAction();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [items, setItems] = useState<DraftItem[]>([{ title: '', estimatedHours: '' }]);

  const toggle = (id: string) => setMemberIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const setItem = (i: number, patch: Partial<DraftItem>) => setItems((cur) => cur.map((it, n) => (n === i ? { ...it, ...patch } : it)));

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      run(() => createProject({ name, description, targetDate: targetDate || undefined, memberIds,
        scopeItems: items.filter((i) => i.title.trim()).map((i) => ({ title: i.title, estimatedHours: i.estimatedHours ? Number(i.estimatedHours) : undefined })) }),
        { onOk: (r) => { if (r.data) router.push(`/projects/${r.data.id}`); } });
    }}>
      <Field label="Product name" error={fieldErrors.name}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Merchant Payouts App" /></Field>
      <Field label="What is this product?" hint="a few sentences — the AI uses this to plan scope and an ETA" error={fieldErrors.description}>
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="A new mobile app for small merchants to accept and reconcile payments, separate from our existing consumer money-transfer app." />
      </Field>
      <Field label="Target date" hint="optional — your own deadline, independent of the AI's estimate" error={fieldErrors.targetDate}>
        <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-44" />
      </Field>

      <div>
        <p className="mb-1.5 text-xs font-medium">Who&apos;s building it?</p>
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <button key={p.id} type="button" onClick={() => toggle(p.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${memberIds.includes(p.id) ? 'border-accent bg-accent-soft text-accent-soft-fg' : 'border-border-strong text-muted hover:bg-surface-2'}`}>
              {p.label}
            </button>))}
          {!people.length && <p className="text-xs text-muted">No one else is active in this company yet.</p>}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">Rough scope <span className="font-normal text-subtle">(optional — you can add items later; hours help the AI&apos;s first estimate)</span></p>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="e.g. KYC onboarding flow" className="flex-1" />
              <Input value={it.estimatedHours} onChange={(e) => setItem(i, { estimatedHours: e.target.value })} type="number" min="0" step="1" placeholder="hrs" className="w-20" />
              <Button type="button" variant="ghost" size="icon" onClick={() => setItems((cur) => cur.filter((_, n) => n !== i))} aria-label="Remove item"><Trash2 className="size-3.5" /></Button>
            </div>))}
        </div>
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setItems((cur) => [...cur, { title: '', estimatedHours: '' }])}><Plus className="size-3.5" />Add scope item</Button>
      </div>

      <p className="text-xs text-muted">After this is created, the AI will propose scope items (if you added none) and an initial ETA — you can always override them.</p>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Create product</Button></div>
    </form>);
}
