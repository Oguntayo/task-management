/** Browser-safe upload constraints shared by the uploader and server validation. */
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
