import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Ignore in Server Component
            }
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data?.user) {
      // Sync user profile to public.users table
      try {
        const user = data.user
        const fullName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split('@')[0] ||
          'สมาชิก'
        const avatarUrl =
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null

        await (supabase.from('users') as any).upsert({
          user_id: user.id,
          email: user.email,
          full_name: fullName,
          avatar_url: avatarUrl,
          last_seen: new Date().toISOString(),
        })
      } catch (syncErr) {
        console.error('Failed to sync user on oauth callback:', syncErr)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If there's an error, redirect to login with error indicator
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
