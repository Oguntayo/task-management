import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

/** Server-only. Gmail SMTP with an App Password; credentials come from env and never reach the browser. */
export function getTransporter(): Transporter | null {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter ??= nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string }) {
  const t = getTransporter();
  if (!t) return { ok: false as const, skipped: true as const, error: 'SMTP not configured' };
  try {
    const info = await t.sendMail({ from: `"${process.env.EMAIL_FROM_NAME ?? 'Workline'}" <${process.env.GMAIL_USER}>`, ...opts });
    return { ok: true as const, messageId: info.messageId };
  } catch (e) {
    return { ok: false as const, skipped: false as const, error: (e as Error).message.slice(0, 500) };
  }
}
