'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { useAction } from '@/components/use-action';
import { savePreferences } from '@/actions/notifications';
import { NOTIFICATION_LABELS, type NotificationType } from '@/lib/email/templates';

export function NotificationPrefsForm({ initial }: { initial: Record<string, { email: boolean; inApp: boolean }> }) {
  const { run, pending } = useAction();
  const types = Object.keys(NOTIFICATION_LABELS) as NotificationType[];
  const [prefs, setPrefs] = useState<Record<string, { email: boolean; inApp: boolean }>>(() =>
    Object.fromEntries(types.map((t) => [t, initial[t] ?? { email: true, inApp: true }])));

  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => savePreferences(types.map((type) => ({ type, ...prefs[type] })))); }}>
      <Card>
        <div className="grid grid-cols-[1fr_70px_70px] items-center gap-2 border-b px-4 py-2 text-[11px] font-medium text-muted"><span>Notification</span><span className="text-center">Email</span><span className="text-center">In-app</span></div>
        <div className="divide-y">{types.map((t) => (
          <div key={t} className="grid grid-cols-[1fr_70px_70px] items-center gap-2 px-4 py-2 text-[13px]">
            <span>{NOTIFICATION_LABELS[t]}</span>
            <span className="text-center"><input type="checkbox" checked={prefs[t].email} onChange={(e) => setPrefs((p) => ({ ...p, [t]: { ...p[t], email: e.target.checked } }))} /></span>
            <span className="text-center"><input type="checkbox" checked={prefs[t].inApp} onChange={(e) => setPrefs((p) => ({ ...p, [t]: { ...p[t], inApp: e.target.checked } }))} /></span>
          </div>))}</div>
      </Card>
      <div className="mt-4 flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save preferences</Button></div>
    </form>);
}
