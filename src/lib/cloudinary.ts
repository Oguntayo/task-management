import { createHash } from 'node:crypto';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/lib/upload-constants';

export { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/lib/upload-constants';

/** Cloudinary signature: sha1 of sorted "k=v" params joined by & plus the API secret. */
export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}

/** Folder is derived server-side from the authenticated membership, never from the client. */
export function buildUploadFolder(companyId: string, kind: 'avatars' | 'tasks' | 'unplanned' | 'logos'): string {
  return `workline/${companyId}/${kind}`;
}

export function validateUpload(meta: { contentType: string; bytes: number }): string | null {
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(meta.contentType)) return 'File type not allowed';
  if (meta.bytes > MAX_UPLOAD_BYTES) return 'File exceeds the 10 MB limit';
  return null;
}

export function isOwnCloudinaryAsset(publicId: string, companyId: string): boolean {
  return publicId.startsWith(`workline/${companyId}/`) && !publicId.includes('..');
}
