'use client';
import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, Textarea } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { generateStandup, generateWeekly, submitStandup, submitWeekly } from '@/actions/reports';
import type { DailySummary, WeeklySummary } from '@/lib/domain/summaries';

/** Renders a generated daily/weekly summary as plain sections — never prose the AI made up, only task/entry records. */
function SummarySection({ title, items, empty }: { title: string; items: React.ReactNode[]; empty?: string }) {
  if (!items.length) return empty ? <p className="text-xs text-muted">{title}: {empty}</p> : null;
  return <div><p className="text-xs font-medium text-muted">{title}</p><ul className="mt-1 space-y-0.5 pl-4 text-[13px]">{items.map((it, i) => <li key={i} className="list-disc">{it}</li>)}</ul></div>;
}

export function DailyReportPanel({ date, existing, status }: { date: string; existing: DailySummary | null; status: 'draft' | 'submitted' | null }) {
  const { run, pending } = useAction();
  const [notes, setNotes] = useState('');
  const submitted = status === 'submitted';
  return (
    <Card>
      <CardHeader title="Today's stand-up" description="Generated from your task records — nothing here is invented."
        action={!submitted && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => generateStandup(date))}><RefreshCw className="size-3.5" />{existing ? 'Regenerate' : 'Generate'}</Button>} />
      <div className="space-y-3 px-4 py-3">
        {!existing ? <EmptyState title="Not generated yet" description="Generate today's summary from your tasks, add any notes, then submit." /> : (<>
          <SummarySection title="Completed" items={existing.completed.map((t) => t.title)} empty="nothing completed today" />
          <SummarySection title="Worked on" items={existing.workedOn.map((t) => `${t.title} (${t.progress}%${t.hours ? `, ${t.hours}h` : ''})`)} />
          <SummarySection title="In progress" items={existing.currentlyWorkingOn.map((t) => `${t.title} (${t.progress}%)`)} />
          <SummarySection title="Blocked" items={existing.blocked.map((t) => `${t.title}${t.blockers.length ? ` — ${t.blockers.join('; ')}` : ''}${t.external ? ' (external)' : ''}`)} />
          <SummarySection title="Unexpected / unplanned" items={existing.unexpected.map((u) => `${u.title} (${u.hours}h, ${u.status.replace(/_/g, ' ')})`)} />
          <SummarySection title="Next up" items={existing.nextUp.map((t) => t.title)} />
          {submitted ? <Badge tone="ok">Submitted</Badge> : (<>
            <Textarea rows={3} placeholder="Add any notes for your PM (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end"><Button variant="primary" loading={pending} onClick={() => run(() => submitStandup(date, notes))}><Send className="size-3.5" />Submit</Button></div>
          </>)}
        </>)}
      </div>
    </Card>);
}

export function WeeklyReportPanel({ weekStartDate, existing, status }: { weekStartDate: string; existing: WeeklySummary | null; status: 'draft' | 'submitted' | null }) {
  const { run, pending } = useAction();
  const [notes, setNotes] = useState('');
  const submitted = status === 'submitted';
  return (
    <Card>
      <CardHeader title="Weekly report" description="Built from this week's commitments and completions — a finished task is never re-reported."
        action={!submitted && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => generateWeekly(weekStartDate))}><RefreshCw className="size-3.5" />{existing ? 'Regenerate' : 'Generate'}</Button>} />
      <div className="space-y-3 px-4 py-3">
        {!existing ? <EmptyState title="Not generated yet" description="Generate this week's summary, add any notes, then submit." /> : (<>
          <SummarySection title="Committed" items={existing.committed.map((t) => t.title)} />
          <SummarySection title="Completed" items={existing.completed.map((t) => `${t.title}${t.onTimeVsOriginal === false ? ' (late vs. original deadline)' : ''}`)} empty="nothing completed" />
          <SummarySection title="Ongoing" items={existing.ongoing.map((t) => `${t.title} (${t.progress}%)`)} />
          <SummarySection title="Overdue" items={existing.overdue.map((t) => t.title)} />
          {existing.unplanned.entries > 0 && <SummarySection title="Unplanned" items={[`${existing.unplanned.entries} entr${existing.unplanned.entries === 1 ? 'y' : 'ies'}, ${existing.unplanned.hours}h total${existing.unplanned.urgent ? `, ${existing.unplanned.urgent} urgent` : ''}`]} />}
          <SummarySection title="Deadline changes" items={existing.deadlineChanges.map((d) => `${d.title}: ${d.from ?? '—'} → ${d.to ?? '—'}`)} />
          <SummarySection title="Next week" items={existing.nextWeekPriorities.map((t) => t.title)} />
          {submitted ? <Badge tone="ok">Submitted</Badge> : (<>
            <Textarea rows={3} placeholder="Add any notes for your PM (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end"><Button variant="primary" loading={pending} onClick={() => run(() => submitWeekly(weekStartDate, notes))}><Send className="size-3.5" />Submit</Button></div>
          </>)}
        </>)}
      </div>
    </Card>);
}
