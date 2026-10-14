'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { loadUnreadCounts } from '@/lib/unreadCounts'
import { LayoutGrid, Crown, User, LogOut, Check } from 'lucide-react'
import { createClient } from '@/utils/supabase'
import { DEMO_USER } from '@/lib/mock-data'

export default function Sidebar({ displayName }: { displayName?: string }) {
  const pathname = usePathname()
  const supabase = createClient()
  const name = displayName || DEMO_USER.name
  // จำนวนกิจกรรมใหม่รวมทุกกลุ่ม (นับใหม่ทุกครั้งที่เปลี่ยนหน้า)
  const [unreadTotal, setUnreadTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const counts = await loadUnreadCounts(supabase, user.id)
      if (!cancelled) setUnreadTotal(Object.values(counts).reduce((sum, n) => sum + n, 0))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [pathname, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  // คงรายการเมนูเดิมของระบบ แต่เปลี่ยนไอคอนเป็น Line/Outline สไตล์ตามรูป
  const navItems = [
    { href: '/dashboard', icon: LayoutGrid, label: 'แดชบอร์ด', exact: true },
    { href: '/dashboard/leader', icon: Crown, label: 'หัวหน้า', exact: false },
    { href: '/dashboard/member', icon: User, label: 'สมาชิก', exact: false },
  ]

  return (
    <aside className="gt-gradient flex shrink-0 flex-row items-center gap-1 px-2 py-2 text-white select-none md:h-screen md:w-[220px] md:flex-col md:items-stretch md:gap-0 md:px-4 md:py-6">
      {/* Brand */}
      <div className="mb-6 hidden items-center gap-2.5 md:flex">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 border border-white/25">
          <Check size={16} strokeWidth={3} />
        </div>
        <span className="text-[20px] font-bold tracking-tight">GroupTask</span>
      </div>

      {/* User Card */}
      <Link
        href="/dashboard/profile"
        title="ตั้งค่าโปรไฟล์"
        className="mb-6 hidden items-center gap-3 p-2.5 rounded-2xl bg-white/10 border border-white/10 hover:bg-white/15 transition md:flex"
      >
        <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center font-bold text-sm ring-2 ring-white/30">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="text-[11px] text-white/60">ตั้งค่าโปรไฟล์</div>
        </div>
      </Link>

      {/* Nav — สไตล์แบบรูป: มุมมน Glassmorphism, ไอคอนเส้นสีขาว, ตัวหนังสือขาวคมชัด */}
      <nav className="flex flex-1 flex-row gap-1 md:flex-col md:gap-2">
        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl px-2 py-2 text-[12px] transition-all duration-200 md:flex-none md:justify-start md:gap-3.5 md:px-4 md:py-3 md:text-[14px] ${
                active
                  ? 'bg-white/25 backdrop-blur-md text-white font-semibold shadow-sm border border-white/15'
                  : 'text-white/80 hover:bg-white/10 hover:text-white font-medium'
              }`}
            >
              <Icon size={19} strokeWidth={2.2} className="shrink-0" />
              <span>{label}</span>
              {href === '/dashboard' && unreadTotal > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-bold leading-5 text-white md:ml-auto">
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* ชื่อบัญชีบนจอแคบ (จอกว้างใช้การ์ดผู้ใช้ด้านบน) */}
      <Link
        href="/dashboard/profile"
        aria-label="ตั้งค่าโปรไฟล์"
        className="flex min-w-0 max-w-[90px] items-center gap-1.5 md:hidden"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20 text-xs font-bold ring-1 ring-white/30">
          {name.charAt(0).toUpperCase()}
        </div>
        <span className="truncate text-[11px] font-semibold">{name}</span>
      </Link>

      {/* ออกจากระบบ — สไตล์เดียวกับเมนู */}
      <button
        onClick={handleSignOut}
        aria-label="ออกจากระบบ"
        className="flex items-center gap-3.5 rounded-2xl px-3 py-2 text-left text-[14px] text-white/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer font-medium md:mt-auto md:px-4 md:py-3"
      >
        <LogOut size={19} strokeWidth={2.2} className="shrink-0" />
        <span className="hidden md:inline">ออกจากระบบ</span>
      </button>

      <p className="mt-4 hidden pt-2 text-[11px] text-white/40 md:block">v2.0 • GroupTask</p>
    </aside>
  )
}
