'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { loadUnreadCounts } from '@/lib/unreadCounts'
import { Home, FolderKanban, CalendarDays, LogOut, Users, Bell } from 'lucide-react'
import { createClient } from '@/utils/supabase'
import UserAvatar from '@/components/ui/UserAvatar'

type UnreadGroup = { group_id: string; group_name: string; count: number }

// กระดิ่ง: จำนวนกิจกรรมใหม่รวมทุกกลุ่ม กดแล้วเห็นว่ามาจากกลุ่มไหน
function NotificationBell({ groups, align }: { groups: UnreadGroup[]; align: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const total = groups.reduce((sum, g) => sum + g.count, 0)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`การแจ้งเตือน ${total} รายการ`}
        className="relative rounded-xl p-2 text-slate-700 hover:bg-slate-100"
      >
        <Bell size={20} />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-slate-800 px-1.5 text-[11px] font-bold leading-5 text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* กดที่อื่นเพื่อปิด */}
          <button aria-label="ปิดการแจ้งเตือน" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-40 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg`}>
            <p className="px-2 pb-1 pt-1 text-[12px] font-semibold text-slate-600">ความเคลื่อนไหวที่ยังไม่ได้อ่าน</p>
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-[13px] text-slate-600">ไม่มีความเคลื่อนไหวใหม่</p>
            ) : (
              groups.map((g) => (
                <Link
                  key={g.group_id}
                  href={`/dashboard/groups/${g.group_id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-slate-50"
                >
                  <span className="truncate text-[13px] text-slate-800">{g.group_name}</span>
                  <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[12px] font-semibold text-white">{g.count} ใหม่</span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function Sidebar({ displayName, avatarUrl }: { displayName?: string; avatarUrl?: string | null }) {
  const pathname = usePathname()
  const supabase = createClient()
  const name = displayName || ''
  // กิจกรรมใหม่แยกตามกลุ่ม (นับใหม่ทุกครั้งที่เปลี่ยนหน้า)
  const [unreadGroups, setUnreadGroups] = useState<UnreadGroup[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const counts = await loadUnreadCounts(supabase, user.id)
      const ids = Object.keys(counts)
      if (ids.length === 0) {
        if (!cancelled) setUnreadGroups([])
        return
      }
      const { data: rows } = await supabase.from('groups').select('group_id, group_name').in('group_id', ids)
      if (cancelled) return
      setUnreadGroups(
        (rows || [])
          .map((g) => ({ group_id: g.group_id, group_name: g.group_name, count: counts[g.group_id] }))
          .sort((a, b) => b.count - a.count),
      )
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

  const navItems = [
    { href: '/dashboard', icon: Home, label: 'หน้าหลัก', exact: true },
    { href: '/dashboard/groups', icon: FolderKanban, label: 'กลุ่มของฉัน', exact: false },
    { href: '/dashboard/calendar', icon: CalendarDays, label: 'ปฏิทิน', exact: false },
  ]

  return (
    <aside className="flex shrink-0 flex-row items-center gap-1 border-b border-slate-200 bg-white px-2 py-2 select-none md:h-screen md:w-[220px] md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-4 md:py-6">
      {/* Brand + กระดิ่ง (จอกว้าง) — gradient เหลือไว้แค่โลโก้ */}
      <div className="mb-6 hidden items-center justify-between md:flex">
        <div className="flex items-center gap-2.5">
          <div className="gt-gradient flex h-8 w-8 items-center justify-center rounded-xl text-white">
            <Users size={16} strokeWidth={2.2} />
          </div>
          <span className="text-[20px] font-bold tracking-tight text-slate-900">GroupTask</span>
        </div>
        <NotificationBell groups={unreadGroups} align="left" />
      </div>

      <nav className="flex flex-1 flex-row gap-1 md:flex-col md:gap-1.5">
        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12px] transition-colors md:flex-none md:justify-start md:gap-3 md:px-3 md:py-2.5 md:text-[14px] ${
                active
                  ? 'bg-violet-50 font-semibold text-violet-700'
                  : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon size={19} strokeWidth={2.2} className="shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* กระดิ่ง + ชื่อบัญชีบนจอแคบ */}
      <div className="md:hidden">
        <NotificationBell groups={unreadGroups} align="right" />
      </div>
      <Link
        href="/dashboard/profile"
        aria-label="ตั้งค่าโปรไฟล์"
        className="flex min-w-0 max-w-[90px] items-center gap-1.5 md:hidden"
      >
        <UserAvatar src={avatarUrl} name={name} className="h-7 w-7 rounded-lg bg-slate-200 text-xs text-slate-700" />
        <span className="truncate text-[11px] font-semibold text-slate-800">{name}</span>
      </Link>

      {/* โปรไฟล์ + ออกจากระบบ (จอกว้างอยู่ล่างสุด) */}
      <Link
        href="/dashboard/profile"
        title="ตั้งค่าโปรไฟล์"
        className={`mt-auto hidden items-center gap-3 rounded-xl p-2 transition-colors md:flex ${
          pathname.startsWith('/dashboard/profile') ? 'bg-violet-50' : 'hover:bg-slate-100'
        }`}
      >
        <UserAvatar src={avatarUrl} name={name} className="h-9 w-9 rounded-xl bg-slate-200 text-sm text-slate-700" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-900">{name}</div>
          <div className="text-[12px] text-slate-600">ตั้งค่าโปรไฟล์</div>
        </div>
      </Link>
      <button
        onClick={handleSignOut}
        aria-label="ออกจากระบบ"
        className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 md:mt-1 md:px-3 md:py-2.5"
      >
        <LogOut size={19} strokeWidth={2.2} className="shrink-0" />
        <span className="hidden md:inline">ออกจากระบบ</span>
      </button>
    </aside>
  )
}
