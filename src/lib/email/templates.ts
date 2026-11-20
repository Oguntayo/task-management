export type NotificationType =
  | 'task_submitted' | 'task_approved' | 'task_rejected' | 'task_clarification'
  | 'deadline_approaching' | 'deadline_today' | 'deadline_missed'
  | 'extension_requested' | 'extension_approved' | 'extension_rejected' | 'extension_clarification'
  | 'blocker_reported' | 'blocker_resolved'
  | 'unplanned_submitted' | 'unplanned_review_needed' | 'unplanned_decided'
  | 'weekly_report_available';

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  task_submitted: 'New task submitted', task_approved: 'Task approved', task_rejected: 'Task rejected',
  task_clarification: 'Task needs clarification', deadline_approaching: 'Deadline approaching',
  deadline_today: 'Deadline today', deadline_missed: 'Deadline missed',
  extension_requested: 'Deadline extension requested', extension_approved: 'Extension approved',
  extension_rejected: 'Extension rejected', extension_clarification: 'Extension needs clarification',
  blocker_reported: 'Blocker reported', blocker_resolved: 'Blocker resolved',
  unplanned_submitted: 'Unplanned work logged', unplanned_review_needed: 'Unplanned work needs review',
  unplanned_decided: 'Unplanned work reviewed', weekly_report_available: 'Weekly report available',
};

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface EmailContent { title: string; intro: string; details?: Array<[string, string]>; ctaLabel?: string; ctaUrl?: string; footerNote?: string; }

/** Table-based, inline-styled HTML for broad client support. All dynamic text is escaped. */
export function renderEmail(c: EmailContent, brand = 'Workline'): { html: string; text: string } {
  const rows = (c.details ?? []).map(([k, v]) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#111827;font-size:14px">${escapeHtml(v)}</td></tr>`).join('');
  const cta = c.ctaUrl && /^https?:\/\//.test(c.ctaUrl)
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(c.ctaUrl)}" style="background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500;display:inline-block">${escapeHtml(c.ctaLabel ?? 'Open in ' + brand)}</a></p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px">
<tr><td style="padding:20px 28px;border-bottom:1px solid #f0f0f1;font-weight:600;font-size:15px;color:#111827">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:18px;color:#111827">${escapeHtml(c.title)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151">${escapeHtml(c.intro)}</p>
${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px">${rows}</table>` : ''}${cta}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f0f0f1;font-size:12px;color:#9ca3af">${escapeHtml(c.footerNote ?? 'You can change which emails you receive in Settings → Notifications.')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [c.title, '', c.intro, '', ...(c.details ?? []).map(([k, v]) => `${k}: ${v}`), c.ctaUrl ? `\n${c.ctaUrl}` : ''].join('\n');
  return { html, text };
}

/** Stable key so the same event is never sent twice to the same person (enforced by unique indexes). */
export function dedupeKey(parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== '').join(':');
}
