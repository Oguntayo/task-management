import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite', '/auth', '/api/cron'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser(); // validates the JWT with Supabase Auth
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + '/'));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone(); url.pathname = '/login'; url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  if (user && (path === '/login' || path === '/register')) {
    const url = request.nextUrl.clone(); url.pathname = '/dashboard'; url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}
