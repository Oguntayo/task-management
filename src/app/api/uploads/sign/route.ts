import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { buildUploadFolder, signParams, validateUpload } from '@/lib/cloudinary';

/** Issues a short-lived signed upload. The folder is derived from the caller's verified membership, never from client input. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as { companyId?: string; kind?: string; contentType?: string; bytes?: number } | null;
  if (!body?.companyId || !body.contentType || typeof body.bytes !== 'number' || !['avatars', 'tasks', 'unplanned', 'logos'].includes(body.kind ?? '')) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const invalid = validateUpload({ contentType: body.contentType, bytes: body.bytes });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const sb = await createClient();
  const { data: m } = await sb.from('company_memberships').select('id').eq('company_id', body.companyId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
  if (!m) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await rateLimit(createAdminClient(), `upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.window))) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !key || !secret) return NextResponse.json({ error: 'Uploads are not configured' }, { status: 503 });
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: buildUploadFolder(body.companyId, body.kind as 'tasks'), timestamp, allowed_formats: 'jpg,jpeg,png,webp,pdf,txt,csv' };
  return NextResponse.json({ cloudName: cloud, apiKey: key, ...params, signature: signParams(params, secret) });
}
