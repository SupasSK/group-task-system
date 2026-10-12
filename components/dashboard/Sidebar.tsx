'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Crown, User, LogOut, Check } from 'lucide-react'
import { createClient } from '@/utils/supabase'
import { DEMO_USER } from '@/lib/mock-data'

export default function Sidebar({ displayName }: { displayName?: string }) {
  const pathname = usePathname()
  const supabase = createClient()
  const name = displayName || DEMO_USER.name

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
    <aside className="gt-gradient flex h-screen w-[220px] shrink-0 flex-col px-4 py-6 text-white select-none">
      {/* Brand */}
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20 border border-white/25">
          <Check size={16} strokeWidth={3} />
        </div>
        <span className="text-[20px] font-bold tracking-tight">GroupTask</span>
      </div>

      {/* User Card */}
      <div className="mb-6 flex items-center gap-3 p-2.5 rounded-2xl bg-white/10 border border-white/10">
        <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center font-bold text-sm ring-2 ring-white/30">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="text-[11px] text-white/60">ออนไลน์</div>
        </div>
      </div>

      {/* Nav — สไตล์แบบรูป: มุมมน Glassmorphism, ไอคอนเส้นสีขาว, ตัวหนังสือขาวคมชัด */}
      <nav className="flex flex-1 flex-col gap-2">
        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3.5 rounded-2xl px-4 py-3 text-[14px] transition-all duration-200 ${
                active
                  ? 'bg-white/25 backdrop-blur-md text-white font-semibold shadow-sm border border-white/15'
                  : 'text-white/80 hover:bg-white/10 hover:text-white font-medium'
              }`}
            >
              <Icon size={19} strokeWidth={2.2} className="shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* ออกจากระบบ — สไตล์เดียวกับเมนู */}
      <button
        onClick={handleSignOut}
        className="flex items-center gap-3.5 rounded-2xl px-4 py-3 text-left text-[14px] text-white/80 hover:bg-white/10 hover:text-white transition-all cursor-pointer font-medium mt-auto"
      >
        <LogOut size={19} strokeWidth={2.2} className="shrink-0" />
        <span>ออกจากระบบ</span>
      </button>

      <p className="mt-4 pt-2 text-[11px] text-white/40">v2.0 • GroupTask</p>
    </aside>
  )
}
