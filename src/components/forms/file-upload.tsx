'use client';
import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/lib/upload-constants';

export interface UploadedFile { publicId: string; url: string; resourceType: string; format?: string; bytes?: number; name?: string; }

/** Direct-to-Cloudinary upload using a server-signed, tenant-scoped request. The API secret never reaches the browser. */
export function FileUpload({ companyId, kind, files, onChange }: { companyId: string; kind: 'tasks' | 'unplanned'; files: UploadedFile[]; onChange: (f: UploadedFile[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return toast.error('Allowed: images, PDF, text and CSV files');
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('Files can be up to 10 MB');
    setBusy(true);
    try {
      const sig = await fetch('/api/uploads/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, kind, contentType: file.type, bytes: file.size }) });
      if (!sig.ok) throw new Error((await sig.json().catch(() => ({}))).error ?? 'Upload failed');
      const s = await sig.json();
      const fd = new FormData();
      fd.set('file', file); fd.set('api_key', s.apiKey); fd.set('timestamp', String(s.timestamp)); fd.set('folder', s.folder); fd.set('allowed_formats', s.allowed_formats); fd.set('signature', s.signature);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const r = await res.json();
      onChange([...files, { publicId: r.public_id, url: r.secure_url, resourceType: r.resource_type, format: r.format, bytes: r.bytes, name: file.name }]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <div>
      <input ref={input} type="file" hidden accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border-strong px-3 text-[13px] text-muted hover:bg-surface-2 disabled:opacity-50"><Paperclip className="size-3.5" />{busy ? 'Uploading…' : 'Attach evidence'}</button>
      {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((f) => (<li key={f.publicId} className="flex items-center justify-between rounded bg-surface-2 px-2 py-1 text-xs"><span className="truncate">{f.name ?? f.publicId}</span>
        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((x) => x.publicId !== f.publicId))}><X className="size-3" /></button></li>))}</ul>}
    </div>);
}
