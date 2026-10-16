import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const res = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ถ้ายังไม่ล็อกอิน และไม่ใช่หน้าเข้าสู่ระบบ หน้า callback auth หรือหน้านโยบายความเป็นส่วนตัว → เด้งไปล็อกอิน
  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/auth') && request.nextUrl.pathname !== '/privacy') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // ถ้าล็อกอินแล้ว และเข้าที่หน้าแรกหรือหน้าล็อกอิน → เด้งไปแดชบอร์ด
  if (user && (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/login')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}