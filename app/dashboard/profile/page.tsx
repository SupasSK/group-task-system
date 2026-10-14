'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'

// ตั้งค่าโปรไฟล์: แก้ชื่อที่แสดงใน public.users (ชื่อนี้แสดงในรายชื่อสมาชิกทุกกลุ่ม)
export default function ProfilePage() {
  const supabase = createClient()
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      setEmail(user.email || '')
      const { data: row } = await supabase
        .from('users')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle()
      setName(row?.full_name || (user.user_metadata?.full_name as string) || '')
      setLoading(false)
    }
    load()
  }, [supabase])

  const handleSave = async () => {
    const next = name.trim()
    if (!next) return

    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('users')
      .update({ full_name: next })
      .eq('user_id', userId)
      .select('user_id')

    if (error) {
      setMessage({ type: 'error', text: `บันทึกไม่สำเร็จ: ${error.message}` })
    } else if (!data || data.length === 0) {
      // RLS ไม่ให้แก้แถวนี้ (ยังไม่ได้รัน supabase-profile.sql)
      setMessage({ type: 'error', text: 'บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้ไขโปรไฟล์' })
    } else {
      setName(next)
      setMessage({ type: 'success', text: 'บันทึกชื่อเรียบร้อยแล้ว' })
      window.dispatchEvent(new CustomEvent('profile-updated', { detail: next }))
    }
    setSaving(false)
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-slate-800">ตั้งค่าโปรไฟล์</h1>
        <p className="text-[13px] text-slate-500 mt-1">ชื่อที่แสดงจะปรากฏในรายชื่อสมาชิกและประวัติกิจกรรมของทุกกลุ่ม</p>
      </div>

      <div className="gt-card p-6 border border-slate-100 space-y-4">
        {loading ? (
          <p className="text-sm text-slate-400">กำลังโหลด...</p>
        ) : (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">อีเมล</label>
              <p className="text-sm text-slate-700">{email}</p>
            </div>
            <div>
              <label htmlFor="full_name" className="block text-xs font-semibold text-slate-600 mb-1.5">
                ชื่อที่แสดง
              </label>
              <input
                id="full_name"
                className="gt-input"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {message && (
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  message.type === 'error'
                    ? 'bg-rose-50 border-rose-100 text-rose-700'
                    : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                }`}
              >
                {message.text}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
