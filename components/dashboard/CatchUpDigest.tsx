'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'

interface Member {
  user_id: string
  full_name: string | null
  email: string | null
}

interface ActivityLog {
  log_id: number
  actor_id: string
  action_type: string
  entity_type: string | null
  entity_id: string | null
  // รูปแบบ payload ต่างกันตาม action_type (ดู AGENTS.md)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอผู้รับ',
  assigned: 'รอตอบรับ',
  accepted: 'รับแล้ว',
  in_progress: 'กำลังทำ',
  completed: 'เสร็จแล้ว',
  rejected: 'ถูกปฏิเสธ',
}

const PRIORITY_LABEL: Record<string, string> = { low: 'ต่ำ', medium: 'กลาง', high: 'สูง', urgent: 'ด่วน' }

const FIELD_LABEL: Record<string, string> = {
  title: 'ชื่องาน',
  description: 'รายละเอียด',
  priority: 'ความสำคัญ',
  deadline: 'กำหนดส่ง',
  assigned_to: 'ผู้รับผิดชอบ',
  work_url: 'ลิงก์ผลงาน',
  progress: 'ความคืบหน้า',
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('th-TH', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CatchUpDigest({
  groupId,
  currentUserId,
  members,
  trackVisit = true,
  onOpenTasks,
}: {
  // ถ้าส่งมา จะแสดงปุ่มพาไปแท็บงาน ใต้หัวข้อการเปลี่ยนแปลงของแต่ละงาน
  onOpenTasks?: () => void
  groupId: string
  currentUserId: string
  members: Member[]
  // false = แสดงอย่างเดียว ไม่บันทึกว่าเข้าดูแล้ว (ใช้ในหน้าหัวหน้า)
  trackVisit?: boolean
}) {
  const supabase = createClient()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  // เวลาที่เข้าดูกลุ่มนี้ครั้งก่อน (null = เข้าครั้งแรก)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  // จุดเริ่มของช่วงที่นำมาสรุป: เวลาเข้าดูครั้งก่อน หรือ 24 ชม. ที่แล้ว แล้วแต่อันไหนเก่ากว่า
  const [since, setSince] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifyText, setVerifyText] = useState<{ ok: boolean; text: string } | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data: visit, error: visitErr } = await supabase
        .from('group_visits')
        .select('last_seen_at')
        .eq('group_id', groupId)
        .eq('user_id', currentUserId)
        .maybeSingle()
      if (cancelled) return

      const { data: logRows, error: logErr } = await supabase
        .from('activity_logs')
        .select('log_id, actor_id, action_type, entity_type, entity_id, payload, created_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return

      if (visitErr || logErr) {
        setError((visitErr || logErr)!.message)
        setLoading(false)
        return
      }

      const seen: string | null = visit?.last_seen_at ?? null
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      setLastSeen(seen)
      setSince(seen && new Date(seen) < dayAgo ? seen : dayAgo.toISOString())
      setLogs(logRows || [])
      setLoading(false)

      if (!trackVisit) return

      // บันทึกเวลาเข้าดูครั้งนี้ หลังจากอ่านค่าเดิมไปแล้ว
      const { error: saveErr } = await supabase
        .from('group_visits')
        .upsert(
          { user_id: currentUserId, group_id: groupId, last_seen_at: new Date().toISOString() },
          { onConflict: 'user_id,group_id' }
        )
      if (saveErr && !cancelled) setError(`บันทึกเวลาเข้าดูไม่สำเร็จ: ${saveErr.message}`)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [groupId, currentUserId, supabase, trackVisit])

  const getName = (userId: string) => {
    const m = members.find((item) => item.user_id === userId)
    return m?.full_name || m?.email || 'สมาชิก'
  }

  const formatValue = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return 'ไม่ระบุ'
    const text = String(value)
    if (field === 'priority') return PRIORITY_LABEL[text] ?? text
    if (field === 'progress') return `${text}%`
    if (field === 'deadline') return formatDateTime(text)
    if (field === 'assigned_to') return getName(text)
    return text
  }

  const describe = (log: ActivityLog) => {
    const p = log.payload || {}
    switch (log.action_type) {
      case 'group_created':
        return 'สร้างกลุ่ม'
      case 'member_added':
        return p.via === 'join_code' ? 'เข้าร่วมกลุ่มด้วยรหัส' : `เพิ่มสมาชิก${p.email ? ` ${p.email}` : ''}`
      case 'task_created':
        return `สร้างงาน (ความสำคัญ${PRIORITY_LABEL[p.priority] ?? 'ไม่ระบุ'}, กำหนดส่ง ${formatValue('deadline', p.deadline)})`
      case 'task_updated':
        return (
          'แก้ไขงาน: ' +
          Object.entries((p.changes || {}) as Record<string, { from?: unknown; to?: unknown }>)
            .map(
              ([field, c]) =>
                `${FIELD_LABEL[field] ?? field} จาก "${formatValue(field, c?.from)}" เป็น "${formatValue(field, c?.to)}"`
            )
            .join(', ')
        )
      case 'task_status_changed':
        return `เปลี่ยนสถานะจาก "${STATUS_LABEL[p.from] ?? p.from}" เป็น "${STATUS_LABEL[p.to] ?? p.to}"`
      case 'task_assigned':
        return `มอบหมายงานให้ ${p.assigned_to ? getName(p.assigned_to) : 'สมาชิกเลือกเอง'}`
      case 'task_accepted':
        return 'รับงาน'
      case 'task_declined':
        return `ปฏิเสธงาน เหตุผล: ${p.reason || 'ไม่ระบุ'}`
      case 'task_claimed':
        return 'เลือกรับงานเอง'
      case 'comment_added':
        return `เขียนบันทึก: ${p.preview || ''}`
      case 'decision_added':
        return `บันทึกการตัดสินใจ: ${p.preview || ''}`
      default:
        return log.action_type
    }
  }

  const handleVerify = async () => {
    setVerifying(true)
    const { data, error: rpcErr } = await supabase.rpc('verify_activity_chain', { p_group_id: groupId })
    if (rpcErr) {
      setVerifyText({ ok: false, text: `ตรวจสอบไม่สำเร็จ: ${rpcErr.message}` })
    } else if (data?.[0]?.is_valid) {
      setVerifyText({ ok: true, text: 'ประวัติครบถ้วน ไม่มีรายการใดถูกแก้ไขหรือลบ' })
    } else {
      setVerifyText({ ok: false, text: `พบความผิดปกติของประวัติที่ลำดับ ${data?.[0]?.broken_at_seq ?? '-'}` })
    }
    setVerifying(false)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
        กำลังโหลดการเปลี่ยนแปลงล่าสุด...
      </div>
    )
  }

  // การเปลี่ยนแปลงของคนอื่นตั้งแต่เข้าดูครั้งก่อน (หรือย้อนหลัง 24 ชม. แล้วแต่อันไหนนานกว่า) จัดกลุ่มตามงาน
  const isNew = (l: ActivityLog) => !lastSeen || new Date(l.created_at) > new Date(lastSeen)
  const newLogs = since
    ? logs.filter((l) => l.actor_id !== currentUserId && new Date(l.created_at) > new Date(since))
    : []
  const topics: { key: string; title: string; items: ActivityLog[] }[] = []
  for (const log of [...newLogs].reverse()) {
    const key = log.entity_type === 'task' && log.entity_id ? log.entity_id : 'group'
    let topic = topics.find((t) => t.key === key)
    if (!topic) {
      topic = { key, title: key === 'group' ? 'เรื่องทั่วไปของกลุ่ม' : `งาน: ${log.payload?.title || 'ไม่ทราบชื่อ'}`, items: [] }
      topics.push(topic)
    }
    topic.items.push(log)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-xs text-rose-700">{error}</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-gray-800">มีอะไรเปลี่ยนตั้งแต่คุณเข้ามาครั้งล่าสุด</h2>
          {onOpenTasks && (
            <button
              onClick={onOpenTasks}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              ดูงานและผลงานทั้งหมด →
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {lastSeen ? `เข้าดูครั้งล่าสุด ${formatDateTime(lastSeen)}` : 'นี่คือการเข้าดูกลุ่มนี้ครั้งแรกของคุณ'} ·
          รายการจะค้างแสดงอย่างน้อย 24 ชั่วโมง
        </p>

        {topics.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">ไม่มีการเปลี่ยนแปลงจากสมาชิกคนอื่นในช่วงนี้</p>
        ) : (
          <div className="mt-4 space-y-3">
            {topics.map((topic) => (
              <div key={topic.key} className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-3.5">
                <p className="text-sm font-semibold text-gray-800">{topic.title}</p>
                <ul className="mt-2 space-y-1.5">
                  {topic.items.map((log) => (
                    <li key={log.log_id} className="text-xs text-gray-600">
                      {isNew(log) && (
                        <span className="mr-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          ใหม่
                        </span>
                      )}
                      <span className="font-semibold text-gray-700">{getName(log.actor_id)}</span> {describe(log)}
                      <span className="text-gray-400"> · {formatDateTime(log.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-800">ประวัติกิจกรรมทั้งหมด</h2>
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {verifying ? 'กำลังตรวจสอบ...' : 'ตรวจสอบความถูกต้องของประวัติ'}
          </button>
        </div>
        {verifyText && (
          <p className={`mt-3 text-xs ${verifyText.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{verifyText.text}</p>
        )}

        {logs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">ยังไม่มีกิจกรรมในกลุ่ม</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {logs.map((log) => (
              <li key={log.log_id} className="py-2.5 text-xs text-gray-600">
                <span className="font-semibold text-gray-700">{getName(log.actor_id)}</span> {describe(log)}
                {log.payload?.title && log.entity_type === 'task' && (
                  <span className="text-gray-500"> — งาน &quot;{log.payload.title}&quot;</span>
                )}
                <span className="block text-[11px] text-gray-400">{formatDateTime(log.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
