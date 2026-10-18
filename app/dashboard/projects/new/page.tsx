'use client'
import { useRef, useState } from 'react'
import { createClient } from '@/utils/supabase'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { logActivity } from '@/lib/logActivity'
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'

const WORK_MODES = [
  { value: 'leader_all', label: 'หัวหน้าคุมทั้งหมด', help: 'หัวหน้ามอบหมายงานให้คนอื่น' },
  { value: 'member_choose', label: 'สมาชิกเลือกเอง', help: 'เปิดรายการงานให้สมาชิกเลือกรับ' },
  { value: 'mixed', label: 'แบบผสมผสาน', help: 'หัวหน้ามอบหมายได้ และเปิดงานว่างให้เลือกได้' },
]

const card = 'rounded-2xl border border-slate-200 bg-white p-5'
const input = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px] text-slate-900 outline-none focus:border-violet-500'

// หน้าเดียวมีทั้งเข้ากลุ่มด้วยรหัสและสร้างกลุ่มใหม่ ใช้ทั้ง /projects/new และ /projects/join
export default function CreateOrJoinGroupPage() {
  const supabase = createClient()
  const router = useRouter()
  const pathname = usePathname()

  // ===== เข้ากลุ่มด้วยรหัส =====
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [joining, setJoining] = useState(false)
  const [joinMessage, setJoinMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  // ===== สร้างกลุ่ม =====
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [created, setCreated] = useState<{ group_id: string; join_code: string } | null>(null)
  const [form, setForm] = useState({
    group_name: '',
    description: '',
    work_mode: 'mixed'
  })

  const updateDigit = (index: number, value: string) => {
    // รองรับตัวเลขและตัวอักษรภาษาอังกฤษ
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!clean) {
      const copy = [...digits]
      copy[index] = ''
      setDigits(copy)
      return
    }
    const nextChar = clean.slice(-1)
    const copy = [...digits]
    copy[index] = nextChar
    setDigits(copy)
    if (index < 5) inputs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (pasted) {
      const chars = pasted.slice(0, 6).split('')
      const newDigits = [...digits]
      chars.forEach((c, idx) => {
        newDigits[idx] = c
      })
      setDigits(newDigits)
      const nextFocus = Math.min(chars.length, 5)
      inputs.current[nextFocus]?.focus()
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = digits.join('').toUpperCase()
    setJoinMessage(null)
    if (code.length !== 6) {
      setJoinMessage({ type: 'error', text: 'กรุณากรอกรหัสกลุ่ม 6 ตัวอักษรให้ครบถ้วน' })
      return
    }

    setJoining(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setJoinMessage({ type: 'error', text: 'กรุณาเข้าสู่ระบบก่อนเข้าร่วมกลุ่ม' })
        router.push('/login')
        return
      }

      const { data: rows, error: rpcError } = await supabase.rpc(
        'join_group_by_code',
        { p_code: code }
      )

      if (rpcError) {
        setJoinMessage({ type: 'error', text: 'เข้าร่วมกลุ่มไม่สำเร็จ: ' + rpcError.message })
        setJoining(false)
        return
      }

      if (!rows || rows.length === 0) {
        setJoinMessage({ type: 'error', text: 'ไม่พบกลุ่มที่ตรงกับรหัสนี้ หรือรหัสไม่ถูกต้อง' })
        setJoining(false)
        return
      }

      const result = rows[0] as {
        joined_group_id: string
        joined_group_name: string
        newly_joined: boolean
      }

      setJoinMessage({
        type: 'success',
        text: result.newly_joined
          ? `เข้าร่วมกลุ่ม "${result.joined_group_name}" สำเร็จแล้ว กำลังพาไปที่กลุ่ม...`
          : `คุณเป็นสมาชิกของกลุ่ม "${result.joined_group_name}" อยู่แล้ว กำลังพาไปที่กลุ่ม...`,
      })

      router.push(`/dashboard/groups/${result.joined_group_id}`)
    } catch (err: any) {
      setJoinMessage({ type: 'error', text: 'เกิดข้อผิดพลาด: ' + err.message })
    } finally {
      setJoining(false)
    }
  }

  const generateJoinCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setFormError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setFormError('กรุณาเข้าสู่ระบบก่อน')
      setCreating(false)
      return
    }

    const joinCode = generateJoinCode()

    // 1. สร้างกลุ่ม
    const { data: group, error: groupErr } = await (supabase
      .from('groups') as any)
      .insert({
        group_name: form.group_name,
        description: form.description,
        work_mode: form.work_mode,
        join_code: joinCode,
        created_by: user.id
      })
      .select()
      .single()

    if (groupErr || !group) {
      setFormError('สร้างกลุ่มไม่สำเร็จ: ' + (groupErr?.message || 'ไม่พบข้อมูลกลุ่ม'))
      setCreating(false)
      return
    }

    // 2. เพิ่มผู้สร้างเป็นหัวหน้ากลุ่ม
    const { error: memberErr } = await (supabase
      .from('group_members') as any)
      .insert({
        group_id: (group as any).group_id,
        user_id: user.id,
        role: 'leader'
      })

    if (memberErr) {
      setFormError('เพิ่มสมาชิกไม่สำเร็จ: ' + memberErr.message)
      setCreating(false)
      return
    }

    await logActivity(supabase, {
      groupId: group.group_id,
      action: 'group_created',
      entityType: 'group',
      entityId: group.group_id,
      payload: { group_name: form.group_name, work_mode: form.work_mode },
    })
    await logActivity(supabase, {
      groupId: group.group_id,
      action: 'member_added',
      entityType: 'member',
      entityId: user.id,
      payload: { role: 'leader' },
    })

    setCreated({ group_id: group.group_id, join_code: joinCode })
    setCreating(false)
    setForm({ group_name: '', description: '', work_mode: 'mixed' })
  }

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/groups"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft size={15} /> กลับไปกลุ่มของฉัน
      </Link>
      <h1 className="text-[24px] font-bold text-slate-900">สร้าง / เข้ากลุ่ม</h1>

      <div className="grid gap-5 md:grid-cols-2">
        {/* ===== เข้ากลุ่มด้วยรหัส ===== */}
        <form onSubmit={handleJoin} className={`${card} space-y-4 self-start`}>
          <div>
            <h2 className="text-[16px] font-bold text-slate-900">เข้ากลุ่มด้วยรหัส</h2>
            <p className="text-[13px] text-slate-700">กรอกรหัส 6 ตัว (ตัวอักษรหรือตัวเลข) ที่ได้จากหัวหน้ากลุ่ม</p>
          </div>
          {joinMessage && (
            <div
              className={`flex items-start gap-2 rounded-xl p-3 text-left text-sm ${
                joinMessage.type === 'success'
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              {joinMessage.type === 'success' ? (
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
              )}
              <span>{joinMessage.text}</span>
            </div>
          )}
          <div className="flex gap-1.5 sm:gap-2" onPaste={handlePaste}>
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputs.current[index] = el
                }}
                value={digit}
                onChange={(e) => updateDigit(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                maxLength={1}
                autoFocus={index === 0 && pathname.endsWith('/join')}
                aria-label={`รหัสตัวที่ ${index + 1}`}
                className={`h-12 w-10 rounded-xl text-center text-[20px] font-bold text-slate-900 outline-none sm:w-12 ${
                  digit ? 'border-2 border-violet-500 bg-white' : 'border border-slate-300 bg-white focus:border-violet-500'
                }`}
              />
            ))}
          </div>
          <button type="submit" disabled={joining} className="gt-btn px-4 py-2.5 text-[14px]">
            {joining ? 'กำลังตรวจสอบและเข้าร่วม...' : 'เข้าร่วมกลุ่ม'}
          </button>
        </form>

        {/* ===== สร้างกลุ่มใหม่ ===== */}
        <section className={`${card} space-y-4`}>
          {created ? (
            <div className="py-4 text-center">
              <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
              <h2 className="mt-3 text-[18px] font-bold text-slate-900">สร้างกลุ่มสำเร็จ</h2>
              <p className="mt-4 text-[13px] text-slate-700">รหัสเข้าร่วม ส่งให้สมาชิกเพื่อเข้ากลุ่ม</p>
              <p className="mt-2 text-3xl font-bold tracking-[0.3em] text-slate-900">{created.join_code}</p>
              <div className="flex gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  className="flex-1 rounded-xl border border-slate-300 py-2.5 text-[14px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  สร้างกลุ่มอื่น
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/groups/${created.group_id}`)}
                  className="gt-btn flex-1 py-2.5 text-[14px]"
                >
                  ไปที่กลุ่ม
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-[16px] font-bold text-slate-900">สร้างกลุ่มใหม่</h2>
              {formError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <form onSubmit={handleCreate} className="space-y-4">
                <label className="block text-[13px] font-medium text-slate-700">
                  ชื่อกลุ่ม *
                  <input
                    type="text"
                    required
                    value={form.group_name}
                    onChange={(e) => setForm({...form, group_name: e.target.value})}
                    className={`${input} mt-1`}
                    placeholder="เช่น โปรเจกต์วิทยานิพนธ์"
                  />
                </label>
                <label className="block text-[13px] font-medium text-slate-700">
                  รายละเอียด
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({...form, description: e.target.value})}
                    className={`${input} mt-1`}
                    rows={3}
                    placeholder="คำอธิบายกลุ่ม"
                  />
                </label>
                <fieldset>
                  <legend className="mb-1 text-[13px] font-medium text-slate-700">รูปแบบการทำงาน</legend>
                  <div className="space-y-1.5">
                    {WORK_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 ${
                          form.work_mode === m.value ? 'border-violet-500 bg-violet-50' : 'border-slate-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="work_mode"
                          checked={form.work_mode === m.value}
                          onChange={() => setForm({...form, work_mode: m.value})}
                          className="mt-1 accent-violet-600"
                        />
                        <span>
                          <span className="block text-[14px] font-semibold text-slate-900">{m.label}</span>
                          <span className="text-[12px] text-slate-600">{m.help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button type="submit" disabled={creating} className="gt-btn w-full py-2.5 text-[14px]">
                  {creating ? 'กำลังสร้าง...' : 'สร้างกลุ่ม'}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
