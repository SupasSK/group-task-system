'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { KeyRound, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase'

// หน้าตั้งรหัสผ่านใหม่: ลิงก์ในอีเมลรีเซ็ตผ่าน /auth/callback ซึ่งแลก code เป็น session แล้วพามาที่นี่
export default function ResetPasswordPage() {
  const supabase = createClient()
  const router = useRouter()
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setHasSession(!!data.user))
  }, [supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    if (password.length < 8) return setMessage({ type: 'error', text: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' })
    if (password !== confirm) return setMessage({ type: 'error', text: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' })

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setMessage({ type: 'error', text: `ตั้งรหัสผ่านใหม่ไม่สำเร็จ: ${error.message}` })
      return
    }
    setMessage({ type: 'success', text: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กำลังพาไปยังแดชบอร์ด...' })
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="gt-card w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
            <KeyRound size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-800">ตั้งรหัสผ่านใหม่</h1>
            <p className="text-xs text-slate-500">รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร</p>
          </div>
        </div>

        {hasSession === null ? (
          <p className="text-sm text-slate-400">กำลังตรวจสอบลิงก์...</p>
        ) : !hasSession ? (
          <div className="space-y-4">
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ
            </p>
            <Link href="/login" className="gt-btn block rounded-2xl py-3 text-center text-sm">
              กลับไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รหัสผ่านใหม่</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="อย่างน้อย 8 ตัวอักษร"
                className="gt-input w-full"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ยืนยันรหัสผ่านใหม่</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                className="gt-input w-full"
                required
              />
            </div>
            {message && (
              <p className={`rounded-xl px-4 py-3 text-sm ${message.type === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {message.text}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="gt-btn flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
