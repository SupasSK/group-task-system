'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'
import UserAvatar from '@/components/ui/UserAvatar'

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// path ของไฟล์ใน bucket avatars จาก public URL (ใช้ตอนลบไฟล์เก่า)
function avatarPath(url: string) {
  return url.split('/object/public/avatars/')[1]?.split('?')[0] || null
}

// ตั้งค่าโปรไฟล์: แก้ชื่อที่แสดงใน public.users (ชื่อนี้แสดงในรายชื่อสมาชิกทุกกลุ่ม)
// และรูปโปรไฟล์ (รูปที่อัปโหลดเองแสดงก่อนรูป Google) — supabase-avatar.sql
export default function ProfilePage() {
  const supabase = createClient()
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [googleAvatar, setGoogleAvatar] = useState<string | null>(null)
  const [customAvatar, setCustomAvatar] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      setEmail(user.email || '')
      const { data: row } = await supabase
        .from('users')
        .select('full_name, avatar_url, custom_avatar_url')
        .eq('user_id', user.id)
        .maybeSingle()
      setName(row?.full_name || (user.user_metadata?.full_name as string) || '')
      setGoogleAvatar(row?.avatar_url || null)
      setCustomAvatar(row?.custom_avatar_url || null)
      setLoading(false)
    }
    load()
  }, [supabase])

  // บันทึก users.custom_avatar_url คืนข้อความ error หรือ null ถ้าสำเร็จ
  const saveCustomAvatar = async (url: string | null) => {
    const { data, error } = await supabase
      .from('users')
      .update({ custom_avatar_url: url })
      .eq('user_id', userId)
      .select('user_id')
    if (error) return error.message
    if (!data || data.length === 0) return 'ไม่มีสิทธิ์แก้ไขโปรไฟล์'
    return null
  }

  const handleAvatarUpload = async (file: File) => {
    setAvatarMessage(null)
    if (!AVATAR_TYPES.includes(file.type)) {
      setAvatarMessage({ type: 'error', text: 'รองรับเฉพาะไฟล์รูป JPG, PNG, WEBP หรือ GIF' })
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarMessage({ type: 'error', text: 'ไฟล์ใหญ่เกิน 2 MB' })
      return
    }

    setAvatarBusy(true)
    // ตั้งชื่อไฟล์ใหม่ทุกครั้ง เพื่อไม่ให้เบราว์เซอร์แสดงรูปเก่าจากแคช
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type })
    if (uploadErr) {
      setAvatarMessage({ type: 'error', text: `อัปโหลดไม่สำเร็จ: ${uploadErr.message}` })
      setAvatarBusy(false)
      return
    }

    const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
    const saveErr = await saveCustomAvatar(url)
    if (saveErr) {
      await supabase.storage.from('avatars').remove([path])
      setAvatarMessage({ type: 'error', text: `บันทึกรูปไม่สำเร็จ: ${saveErr}` })
      setAvatarBusy(false)
      return
    }

    // ลบไฟล์รูปเก่า (ถ้าลบไม่ได้ก็ไม่กระทบรูปใหม่)
    const oldPath = customAvatar ? avatarPath(customAvatar) : null
    if (oldPath) await supabase.storage.from('avatars').remove([oldPath])

    setCustomAvatar(url)
    setAvatarMessage({ type: 'success', text: 'เปลี่ยนรูปโปรไฟล์เรียบร้อยแล้ว' })
    window.dispatchEvent(new CustomEvent('avatar-updated', { detail: url }))
    setAvatarBusy(false)
  }

  const handleAvatarRemove = async () => {
    if (!customAvatar) return
    setAvatarBusy(true)
    setAvatarMessage(null)
    const saveErr = await saveCustomAvatar(null)
    if (saveErr) {
      setAvatarMessage({ type: 'error', text: `ลบรูปไม่สำเร็จ: ${saveErr}` })
      setAvatarBusy(false)
      return
    }
    const oldPath = avatarPath(customAvatar)
    if (oldPath) await supabase.storage.from('avatars').remove([oldPath])

    setCustomAvatar(null)
    setAvatarMessage({
      type: 'success',
      text: googleAvatar ? 'ลบรูปแล้ว กลับไปใช้รูปจาก Google' : 'ลบรูปโปรไฟล์แล้ว',
    })
    window.dispatchEvent(new CustomEvent('avatar-updated', { detail: googleAvatar }))
    setAvatarBusy(false)
  }

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
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">รูปโปรไฟล์</label>
              <div className="flex items-center gap-4">
                <UserAvatar
                  src={customAvatar || googleAvatar}
                  name={name || email}
                  className="h-16 w-16 rounded-full bg-indigo-100 text-indigo-700 text-xl"
                />
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <label
                      className={`px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition ${
                        avatarBusy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'
                      }`}
                    >
                      {avatarBusy ? 'กำลังบันทึก...' : 'อัปโหลดรูป'}
                      <input
                        type="file"
                        accept={AVATAR_TYPES.join(',')}
                        className="hidden"
                        disabled={avatarBusy}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) handleAvatarUpload(file)
                        }}
                      />
                    </label>
                    {customAvatar && (
                      <button
                        onClick={handleAvatarRemove}
                        disabled={avatarBusy}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition disabled:opacity-60 cursor-pointer"
                      >
                        ลบรูป
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    JPG, PNG, WEBP หรือ GIF ไม่เกิน 2 MB
                    {googleAvatar && !customAvatar && ' · ตอนนี้ใช้รูปจาก Google'}
                  </p>
                </div>
              </div>
              {avatarMessage && (
                <div
                  className={`mt-3 rounded-xl border px-4 py-3 text-xs ${
                    avatarMessage.type === 'error'
                      ? 'bg-rose-50 border-rose-100 text-rose-700'
                      : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                  }`}
                >
                  {avatarMessage.text}
                </div>
              )}
            </div>
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
