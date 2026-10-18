'use client'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  Clock,
  Crown,
  FilePlus,
  FolderPlus,
  Hand,
  Handshake,
  LogOut,
  MessageSquare,
  MessageSquareHeart,
  Pencil,
  Pin,
  RefreshCw,
  Send,
  Star,
  ThumbsUp,
  Trash2,
  UserMinus,
  UserPlus,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/utils/supabase'
import UserAvatar from '@/components/ui/UserAvatar'

interface Member {
  user_id: string
  full_name: string | null
  email: string | null
  avatar?: string | null
}

// ไอคอนและสีของวงกลมบนเส้น timeline (หน้าแดชบอร์ดใช้ร่วมกับกิจกรรมล่าสุด) แยกตามหมวด: กลุ่ม/สมาชิก = ฟ้า, งาน = ม่วง, บันทึก = เขียว, ประเมิน = เหลือง, ลบ/ออก/ปฏิเสธ = แดง
const GROUP_STYLE = 'bg-sky-100 text-sky-600'
const TASK_STYLE = 'bg-indigo-100 text-indigo-600'
const NOTE_STYLE = 'bg-emerald-100 text-emerald-600'
const EVAL_STYLE = 'bg-amber-100 text-amber-600'
const DANGER_STYLE = 'bg-rose-100 text-rose-600'

export const ACTION_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  group_created: { icon: FolderPlus, className: GROUP_STYLE },
  group_deleted: { icon: Trash2, className: DANGER_STYLE },
  member_added: { icon: UserPlus, className: GROUP_STYLE },
  member_removed: { icon: UserMinus, className: DANGER_STYLE },
  member_left: { icon: LogOut, className: DANGER_STYLE },
  leader_transferred: { icon: Crown, className: GROUP_STYLE },
  task_created: { icon: FilePlus, className: TASK_STYLE },
  task_updated: { icon: Pencil, className: TASK_STYLE },
  task_deleted: { icon: Trash2, className: DANGER_STYLE },
  task_status_changed: { icon: RefreshCw, className: TASK_STYLE },
  task_assigned: { icon: Send, className: TASK_STYLE },
  task_accepted: { icon: ThumbsUp, className: TASK_STYLE },
  task_declined: { icon: XCircle, className: DANGER_STYLE },
  task_claimed: { icon: Hand, className: TASK_STYLE },
  task_joined: { icon: Handshake, className: TASK_STYLE },
  task_feedback_added: { icon: MessageSquareHeart, className: NOTE_STYLE },
  comment_added: { icon: MessageSquare, className: NOTE_STYLE },
  decision_added: { icon: Pin, className: NOTE_STYLE },
  eval_round_opened: { icon: Star, className: EVAL_STYLE },
  eval_round_closed: { icon: Star, className: EVAL_STYLE },
}

// การ์ดประวัติแสดงรายการล่าสุดเท่านี้ กด "ดูทั้งหมด" เพื่อแสดงที่เหลือ
const HISTORY_LIMIT = 10

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

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'ง่าย', medium: 'กลาง', hard: 'ยาก' }

const FIELD_LABEL: Record<string, string> = {
  title: 'ชื่องาน',
  description: 'รายละเอียด',
  priority: 'ความสำคัญ',
  difficulty: 'ความยาก',
  deadline: 'กำหนดส่ง',
  headcount: 'จำนวนคน',
  assigned_to: 'ผู้รับผิดชอบ',
  collaborators: 'ผู้ร่วมทำ',
  status: 'สถานะ',
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

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'
}

// หัวคั่นวันของ timeline: วันนี้ / เมื่อวาน / วันที่ (ใส่ปีเมื่อไม่ใช่ปีนี้)
function dayLabel(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'วันนี้'
  if (d.toDateString() === yesterday.toDateString()) return 'เมื่อวาน'
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
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
  // false = แสดงอย่างเดียว ไม่มีปุ่มรับทราบ (ใช้ในหน้าหัวหน้า)
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
  const [acknowledging, setAcknowledging] = useState(false)
  // จำนวนรายการที่แสดงในการ์ดประวัติ
  const [visibleCount, setVisibleCount] = useState(HISTORY_LIMIT)

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
      // ยังไม่เคยกดรับทราบ: แสดงทุกรายการ ให้ตรงกับตัวเลขบนกระดิ่ง (lib/unreadCounts.ts)
      const from = seen ?? new Date(0).toISOString()
      setLastSeen(seen)
      setSince(new Date(from) < dayAgo ? from : dayAgo.toISOString())
      setLogs(logRows || [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [groupId, currentUserId, supabase])

  // บันทึกเวลาเข้าดูเฉพาะเมื่อผู้ใช้กดรับทราบ ป้าย "ใหม่" จะหายไป แต่รายการยังค้างแสดงตามช่วง since เดิม
  const handleAcknowledge = async () => {
    setAcknowledging(true)
    const now = new Date().toISOString()
    const { error: saveErr } = await supabase
      .from('group_visits')
      .upsert({ user_id: currentUserId, group_id: groupId, last_seen_at: now }, { onConflict: 'user_id,group_id' })
    if (saveErr) setError(`บันทึกการรับทราบไม่สำเร็จ: ${saveErr.message}`)
    else setLastSeen(now)
    setAcknowledging(false)
  }

  const getName = (userId: string) => {
    const m = members.find((item) => item.user_id === userId)
    return m?.full_name || m?.email || 'สมาชิก'
  }

  const getAvatar = (userId: string) => members.find((item) => item.user_id === userId)?.avatar ?? null

  const formatValue = (field: string, value: unknown) => {
    if (Array.isArray(value)) return value.length > 0 ? value.map((uid) => getName(String(uid))).join(', ') : 'ไม่มี'
    if (value === null || value === undefined || value === '') return 'ไม่ระบุ'
    const text = String(value)
    if (field === 'priority') return PRIORITY_LABEL[text] ?? text
    if (field === 'difficulty') return DIFFICULTY_LABEL[text] ?? text
    if (field === 'status') return STATUS_LABEL[text] ?? text
    if (field === 'headcount') return `${text} คน`
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
      case 'member_removed':
        return `นำสมาชิก${p.email ? ` ${p.email}` : ''} ออกจากกลุ่ม`
      case 'member_left':
        return 'ออกจากกลุ่ม'
      case 'leader_transferred':
        return 'รับตำแหน่งหัวหน้ากลุ่ม'
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
            .join(', ') +
          (p.reason ? ` เหตุผล: ${p.reason}` : '')
        )
      case 'task_deleted':
        return 'ลบงาน'
      case 'task_status_changed':
        return `เปลี่ยนสถานะจาก "${STATUS_LABEL[p.from] ?? p.from}" เป็น "${STATUS_LABEL[p.to] ?? p.to}"`
      case 'task_assigned':
        if (p.role === 'collaborator') return `เชิญ ${getName(p.assigned_to)} เป็นผู้ร่วมทำ`
        return `มอบหมายงานให้ ${p.assigned_to ? getName(p.assigned_to) : 'สมาชิกเลือกเอง'}`
      case 'task_accepted':
        return 'รับงาน'
      case 'task_declined':
        return `ปฏิเสธงาน เหตุผล: ${p.reason || 'ไม่ระบุ'}`
      case 'task_claimed':
        return 'เลือกรับงานเอง'
      case 'task_joined':
        return 'เข้าร่วมเป็นผู้ร่วมทำ'
      case 'task_feedback_added':
        return 'ส่งฟีดแบคเพื่อนร่วมงาน'
      case 'comment_added':
        return `เขียนบันทึก: ${p.preview || ''}`
      case 'decision_added':
        return `บันทึกการตัดสินใจ: ${p.preview || ''}`
      case 'eval_round_opened':
        return `เปิดรอบประเมินเพื่อน "${p.title || ''}"`
      case 'eval_round_closed':
        return `ปิดรอบประเมินเพื่อน "${p.title || ''}"`
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
  // วนจากใหม่ไปเก่า: หัวข้อที่มีความเคลื่อนไหวล่าสุดขึ้นก่อน ส่วนรายการในหัวข้อแทรกด้านหน้าให้อ่านเรียงตามเวลา
  for (const log of newLogs) {
    const key = log.entity_type === 'task' && log.entity_id ? log.entity_id : 'group'
    let topic = topics.find((t) => t.key === key)
    if (!topic) {
      topic = { key, title: key === 'group' ? 'เรื่องทั่วไปของกลุ่ม' : `งาน: ${log.payload?.title || 'ไม่ทราบชื่อ'}`, items: [] }
      topics.push(topic)
    }
    topic.items.unshift(log)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-xs text-rose-700">{error}</div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-gray-800">มีอะไรเปลี่ยนตั้งแต่คุณเข้ามาครั้งล่าสุด</h2>
          <div className="flex flex-wrap gap-2">
            {trackVisit && newLogs.some(isNew) && (
              <button
                onClick={handleAcknowledge}
                disabled={acknowledging}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-60"
              >
                {acknowledging ? (
                  'กำลังบันทึก...'
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" /> รับทราบ
                  </>
                )}
              </button>
            )}
            {onOpenTasks && (
              <button
                onClick={onOpenTasks}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors cursor-pointer"
              >
                ดูงานและผลงานทั้งหมด <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {lastSeen ? `กดรับทราบครั้งล่าสุด ${formatDateTime(lastSeen)}` : 'คุณยังไม่เคยกดรับทราบในกลุ่มนี้'} ·
          รายการจะค้างแสดงอย่างน้อย 24 ชั่วโมง
        </p>

        {topics.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">ไม่มีการเปลี่ยนแปลงจากสมาชิกคนอื่นในช่วงนี้</p>
        ) : (
          <div className="mt-4 space-y-3">
            {topics.map((topic) => (
              <div key={topic.key} className="rounded-xl bg-slate-50 border border-slate-200 p-3.5">
                <p className="text-sm font-semibold text-gray-800">{topic.title}</p>
                <ul className="mt-2 space-y-1.5">
                  {topic.items.map((log) => (
                    <li key={log.log_id} className="text-xs text-gray-600">
                      {isNew(log) && (
                        <span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
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
            className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-60"
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
          <>
            {/* timeline: เส้นแนวตั้งร้อยทุกรายการ สื่อว่าประวัติเป็นสายต่อเนื่อง แก้หรือลบไม่ได้ */}
            <ol className="relative mt-5">
              <div className="absolute left-4 top-2 bottom-2 w-0.5 -translate-x-1/2 rounded-full bg-gradient-to-b from-indigo-300 to-pink-300" />
              {logs.slice(0, visibleCount).map((log, i, shown) => {
                const style = ACTION_STYLE[log.action_type] ?? { icon: RefreshCw, className: TASK_STYLE }
                const Icon = style.icon
                const day = dayLabel(log.created_at)
                const showDay = i === 0 || dayLabel(shown[i - 1].created_at) !== day
                return (
                  <li key={log.log_id} className="relative">
                    {showDay && (
                      <p className={`relative pl-11 pb-2 text-[11px] font-semibold text-gray-400 ${i > 0 ? 'pt-2' : ''}`}>
                        {day}
                      </p>
                    )}
                    <div className="relative flex gap-3 pb-3">
                      <span
                        className={`relative z-10 mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${style.className}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            src={getAvatar(log.actor_id)}
                            name={getName(log.actor_id)}
                            className="h-6 w-6 rounded-full bg-indigo-100 text-[11px] text-indigo-700"
                          />
                          <span className="min-w-0 truncate text-xs font-semibold text-gray-800">
                            {getName(log.actor_id)}
                          </span>
                          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-gray-400">
                            <Clock className="h-3 w-3" />
                            {formatTime(log.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-xs text-gray-600">{describe(log)}</p>
                        {log.payload?.title && log.entity_type === 'task' && (
                          <p className="mt-0.5 truncate text-[11px] text-gray-400">งาน &quot;{log.payload.title}&quot;</p>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
            {logs.length > visibleCount && (
              <div className="mt-1 text-center">
                <button
                  onClick={() => setVisibleCount(logs.length)}
                  className="text-xs px-4 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  ดูทั้งหมด ({logs.length} รายการ)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
