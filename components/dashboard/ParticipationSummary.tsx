'use client'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createClient } from '@/utils/supabase'
import { taskTeam, taskWeight } from '@/lib/workload'

interface Member {
  user_id: string
  role: string
  full_name: string | null
  email: string | null
}

interface Task {
  task_id?: string
  title?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  difficulty?: string | null
  status: string
  assigned_to: string | null
  deadline: string | null
  completed_at?: string | null
}

interface TaskResponse {
  user_id: string
  response: string
}

// คะแนนเต็มของแต่ละองค์ประกอบ (รวม 100)
const MAX_WORKLOAD = 40
const MAX_PUNCTUAL = 25
const MAX_ACTIVITY = 20
const MAX_CONSISTENCY = 15

// นับกิจกรรมได้ไม่เกินวันละเท่านี้ต่อคน กันการปั๊มความเห็น
const DAILY_ACTIVITY_CAP = 5
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface LogRow {
  actor_id: string
  action_type: string
  payload: { changes?: Record<string, unknown> } | null
  created_at: string
}

// กิจกรรมที่นับ: ความเห็น, การตัดสินใจ และการแก้ลิงก์ผลงาน
function isCountedActivity(log: LogRow) {
  if (log.action_type === 'comment_added' || log.action_type === 'decision_added') return true
  return log.action_type === 'task_updated' && !!log.payload?.changes?.work_url
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-gray-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full gt-gradient-x" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] font-semibold text-gray-600">
        {Math.round(value)}/{max}
      </span>
    </div>
  )
}

interface TaskFeedback {
  feedback_id: string
  task_id: string
  from_user: string
  to_user: string
  score: number
  comment: string | null
}

interface PeerAverage {
  responsibility: number
  quality: number
  teamwork: number
  rounds: number
}

export default function ParticipationSummary({
  groupId,
  groupName,
  members,
  tasks,
  taskResponses,
  showPeerEval = false,
}: {
  groupId: string
  groupName?: string
  members: Member[]
  tasks: Task[]
  taskResponses: TaskResponse[]
  // แสดงผลประเมินเพื่อน (ฐานข้อมูลคืนผลให้เฉพาะหัวหน้า คนอื่นจะไม่เห็นส่วนนี้)
  showPeerEval?: boolean
}) {
  const supabase = createClient()
  const [logs, setLogs] = useState<LogRow[]>([])
  const [collaborators, setCollaborators] = useState<{ task_id: string; user_id: string; status: string }[]>([])
  const [joinedAt, setJoinedAt] = useState<Record<string, string>>({})
  // เวลาที่โหลดข้อมูล ใช้นับจำนวนสัปดาห์ตั้งแต่เข้ากลุ่ม
  const [now, setNow] = useState(0)
  const [logError, setLogError] = useState<string | null>(null)
  // ค่าเฉลี่ยผลประเมินเพื่อนจากทุกรอบที่ปิดแล้ว (null = ไม่มีสิทธิ์ดู หรือยังไม่โหลด)
  const [peerAverages, setPeerAverages] = useState<Record<string, PeerAverage> | null>(null)
  // ฟีดแบคแบบเปิดชื่อจากงานที่ทำร่วมกัน (RLS ให้หัวหน้าอ่านได้ทั้งกลุ่ม)
  const [feedback, setFeedback] = useState<TaskFeedback[]>([])
  const [openFeedbackFor, setOpenFeedbackFor] = useState<string | null>(null)
  // log ล่าสุดของกลุ่ม พิมพ์ hash ไว้ในรายงานเป็นหลักฐานอ้างอิงภายนอกว่าประวัติ ณ ตอนพิมพ์เป็นแบบนี้
  const [latestLog, setLatestLog] = useState<{ seq: number; hash: string; created_at: string } | null>(null)
  const [printedAt, setPrintedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!showPeerEval) return
    supabase
      .from('activity_logs')
      .select('seq, hash, created_at')
      .eq('group_id', groupId)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatestLog(data))
  }, [groupId, supabase, showPeerEval, tasks])

  const handlePrint = () => {
    // ทำเครื่องหมายเฉพาะการ์ดนี้ให้เป็นส่วนที่พิมพ์ (หน้า leader มีหลายการ์ด) ก่อนเปิดหน้าต่างพิมพ์
    flushSync(() => setPrintedAt(new Date()))
    window.addEventListener('afterprint', () => setPrintedAt(null), { once: true })
    window.print()
  }

  useEffect(() => {
    if (!showPeerEval) return
    supabase
      .from('task_feedback')
      .select('feedback_id, task_id, from_user, to_user, score, comment')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setFeedback(data || []))
  }, [groupId, supabase, showPeerEval])

  useEffect(() => {
    if (!showPeerEval) return
    const loadPeerAverages = async () => {
      const { data: rounds } = await supabase
        .from('eval_rounds')
        .select('round_id')
        .eq('group_id', groupId)
        .eq('status', 'closed')

      const sums: Record<string, PeerAverage> = {}
      for (const r of rounds || []) {
        const { data, error } = await supabase.rpc('get_peer_eval_results', { p_round_id: r.round_id })
        if (error) return // ไม่ใช่หัวหน้า
        for (const row of data || []) {
          const s = (sums[row.evaluatee_id] ??= { responsibility: 0, quality: 0, teamwork: 0, rounds: 0 })
          s.responsibility += Number(row.avg_responsibility)
          s.quality += Number(row.avg_quality)
          s.teamwork += Number(row.avg_teamwork)
          s.rounds += 1
        }
      }
      // แต่ละรอบมีน้ำหนักเท่ากัน
      for (const s of Object.values(sums)) {
        s.responsibility /= s.rounds
        s.quality /= s.rounds
        s.teamwork /= s.rounds
      }
      setPeerAverages(sums)
    }
    loadPeerAverages()
  }, [groupId, supabase, showPeerEval])

  useEffect(() => {
    const loadData = async () => {
      const [logRes, collabRes, memberRes] = await Promise.all([
        supabase.from('activity_logs').select('actor_id, action_type, payload, created_at').eq('group_id', groupId),
        supabase.from('task_collaborators').select('task_id, user_id, status').eq('group_id', groupId),
        supabase.from('group_members').select('user_id, joined_at').eq('group_id', groupId),
      ])

      setCollaborators(collabRes.data || [])
      const joined: Record<string, string> = {}
      for (const m of memberRes.data || []) joined[m.user_id] = m.joined_at
      setJoinedAt(joined)
      setNow(Date.now())

      if (logRes.error) {
        setLogError(logRes.error.message)
        return
      }
      setLogs(logRes.data || [])
      setLogError(null)
    }

    loadData()
  }, [groupId, supabase, tasks])

  if (members.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-500 text-sm">
        ยังไม่มีสมาชิกในกลุ่ม
      </div>
    )
  }

  // งานที่เสร็จพร้อมทีม (คนหลัก + ผู้ร่วมทำที่ตอบรับแล้ว) น้ำหนักงานแบ่งเท่ากันในทีม
  const completed = tasks
    .filter((t) => t.status === 'completed')
    .map((t) => ({
      task: t,
      team: taskTeam({ ...t, task_id: t.task_id ?? '' }, collaborators, true),
    }))
    .filter(({ team }) => team.length > 0)

  const stats = members.map((m) => {
    const done = completed.filter(({ team }) => team.includes(m.user_id))
    const points = done.reduce((sum, { task, team }) => sum + taskWeight(task) / team.length, 0)
    const onTime = done.filter(
      ({ task: t }) => !t.deadline || (t.completed_at && new Date(t.completed_at) <= new Date(t.deadline))
    ).length
    const rejected = taskResponses.filter((r) => r.user_id === m.user_id && r.response === 'rejected').length

    const myLogs = logs.filter((l) => l.actor_id === m.user_id)

    // กิจกรรม: นับต่อวันไม่เกิน DAILY_ACTIVITY_CAP
    const perDay: Record<string, number> = {}
    for (const l of myLogs) {
      if (!isCountedActivity(l)) continue
      const day = new Date(l.created_at).toDateString()
      perDay[day] = Math.min(DAILY_ACTIVITY_CAP, (perDay[day] ?? 0) + 1)
    }
    const activity = Object.values(perDay).reduce((sum, n) => sum + n, 0)

    // ความสม่ำเสมอ: สัปดาห์ที่มีกิจกรรมใด ๆ นับจากวันที่เข้ากลุ่ม
    const firstLog = myLogs.reduce((min, l) => Math.min(min, new Date(l.created_at).getTime()), now)
    const start = joinedAt[m.user_id] ? new Date(joinedAt[m.user_id]).getTime() : firstLog
    const totalWeeks = Math.max(1, Math.floor((now - start) / WEEK_MS) + 1)
    const activeWeeks = new Set(
      myLogs.map((l) => Math.max(0, Math.floor((new Date(l.created_at).getTime() - start) / WEEK_MS)))
    ).size

    return { member: m, doneCount: done.length, points, onTime, rejected, activity, activeWeeks, totalWeeks }
  })

  const totalPoints = completed.reduce((sum, { task }) => sum + taskWeight(task), 0)
  const fairShare = totalPoints / members.length
  const maxActivity = Math.max(...stats.map((s) => s.activity))

  const rows = stats
    .map((s) => {
      const workload = fairShare > 0 ? MAX_WORKLOAD * Math.min(1, s.points / fairShare) : 0
      const punctual = s.doneCount > 0 ? (MAX_PUNCTUAL * s.onTime) / s.doneCount : 0
      const activityScore = maxActivity > 0 ? (MAX_ACTIVITY * s.activity) / maxActivity : 0
      const consistency = MAX_CONSISTENCY * Math.min(1, s.activeWeeks / s.totalWeeks)
      const share = totalPoints > 0 ? Math.round((s.points / totalPoints) * 100) : 0
      return {
        ...s,
        workload,
        punctual,
        activityScore,
        consistency,
        share,
        total: Math.round(workload + punctual + activityScore + consistency),
      }
    })
    .sort((a, b) => b.total - a.total)

  return (
    <div className={`${printedAt ? 'gt-print-area ' : ''}bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 space-y-4`}>
      {/* หัวรายงาน แสดงเฉพาะตอนพิมพ์ */}
      {printedAt && (
        <div className="hidden print:block border-b border-gray-200 pb-3 text-xs text-gray-600 space-y-0.5">
          <p className="text-lg font-bold text-gray-800">รายงานสรุปผลการทำงานกลุ่ม{groupName ? `: ${groupName}` : ''}</p>
          <p>พิมพ์เมื่อ {printedAt.toLocaleString('th-TH')}</p>
          {latestLog ? (
            <p className="break-all">
              ประวัติกิจกรรมล่าสุด ลำดับที่ {latestLog.seq} ({new Date(latestLog.created_at).toLocaleString('th-TH')})
              <br />
              hash: <span className="font-mono">{latestLog.hash}</span>
            </p>
          ) : (
            <p>ยังไม่มีประวัติกิจกรรม</p>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800">คะแนนการมีส่วนร่วม (เต็ม 100)</h2>
          <p className="mt-1 text-xs text-gray-500">
            ภาระงาน {MAX_WORKLOAD} + ความตรงเวลา {MAX_PUNCTUAL} + กิจกรรม {MAX_ACTIVITY} + ความสม่ำเสมอ{' '}
            {MAX_CONSISTENCY}
          </p>
          {logError && (
            <p className="mt-2 text-xs text-rose-600">โหลดประวัติกิจกรรมไม่สำเร็จ: {logError}</p>
          )}
        </div>
        {showPeerEval && (
          <button
            onClick={handlePrint}
            className="shrink-0 px-3 py-1.5 border border-indigo-200 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-50 whitespace-nowrap print:hidden"
          >
            พิมพ์ / บันทึก PDF
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.member.user_id} className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800">
                  {r.member.full_name || r.member.email || 'ไม่ทราบชื่อ'}
                </p>
                <p className="text-[11px] text-gray-400">{r.member.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}</p>
              </div>
              <p className="shrink-0 text-xl font-bold text-indigo-600">
                {r.total}
                <span className="text-xs font-normal text-gray-400">/100</span>
              </p>
            </div>

            <div className="space-y-1.5">
              <ScoreBar label="ภาระงาน" value={r.workload} max={MAX_WORKLOAD} />
              <ScoreBar label="ตรงเวลา" value={r.punctual} max={MAX_PUNCTUAL} />
              <ScoreBar label="กิจกรรม" value={r.activityScore} max={MAX_ACTIVITY} />
              <ScoreBar label="สม่ำเสมอ" value={r.consistency} max={MAX_CONSISTENCY} />
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">เสร็จ {r.doneCount} งาน</span>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">{r.share}% ของกลุ่ม</span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                ทันกำหนด {r.onTime}/{r.doneCount}
              </span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">ปฏิเสธ {r.rejected}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">กิจกรรม {r.activity} ครั้ง</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">
                มีกิจกรรม {r.activeWeeks}/{r.totalWeeks} สัปดาห์
              </span>
            </div>

            {/* ผลประเมินเพื่อน แยกจากคะแนนการมีส่วนร่วม (หัวหน้าไม่ถูกประเมิน) */}
            {peerAverages && r.member.role !== 'leader' && (
              <div className="border-t border-slate-200 pt-2 text-[11px] text-gray-500">
                {peerAverages[r.member.user_id] ? (
                  <>
                    <p>
                      ผลประเมินจากเพื่อน{' '}
                      <strong className="text-sm text-amber-600">
                        {(
                          (peerAverages[r.member.user_id].responsibility +
                            peerAverages[r.member.user_id].quality +
                            peerAverages[r.member.user_id].teamwork) /
                          3
                        ).toFixed(1)}
                      </strong>
                      /5 <span className="text-gray-400">({peerAverages[r.member.user_id].rounds} รอบ)</span>
                    </p>
                    <p>
                      ความรับผิดชอบ {peerAverages[r.member.user_id].responsibility.toFixed(1)} · คุณภาพงาน{' '}
                      {peerAverages[r.member.user_id].quality.toFixed(1)} · การทำงานร่วมกัน{' '}
                      {peerAverages[r.member.user_id].teamwork.toFixed(1)}
                    </p>
                  </>
                ) : (
                  <p>ผลประเมินจากเพื่อน: ยังไม่มีผล หรือผู้ประเมินไม่พอ</p>
                )}
              </div>
            )}

            {/* ฟีดแบคจากงานที่ทำร่วมกัน (เปิดชื่อ ใช้ประกอบการจับคู่คนทำงาน) */}
            {showPeerEval &&
              (() => {
                const received = feedback.filter((f) => f.to_user === r.member.user_id)
                if (received.length === 0) return null
                const avg = received.reduce((sum, f) => sum + f.score, 0) / received.length
                const nameOf = (uid: string) => {
                  const m = members.find((item) => item.user_id === uid)
                  return m?.full_name || m?.email || 'สมาชิก'
                }
                const open = openFeedbackFor === r.member.user_id
                return (
                  <div className="border-t border-slate-200 pt-2 text-[11px] text-gray-500 space-y-1">
                    <button
                      onClick={() => setOpenFeedbackFor(open ? null : r.member.user_id)}
                      className="cursor-pointer text-left"
                    >
                      ฟีดแบคจากงานที่ทำร่วมกัน <strong className="text-sm text-teal-600">{avg.toFixed(1)}</strong>/5{' '}
                      <span className="text-gray-400">({received.length} ครั้ง)</span>{' '}
                      <span className="text-indigo-600 print:hidden">{open ? 'ซ่อน' : 'ดูรายละเอียด'}</span>
                    </button>
                    {open && (
                      <ul className="space-y-1">
                        {received.map((f) => (
                          <li key={f.feedback_id} className="rounded-lg bg-white border border-slate-100 px-2 py-1">
                            <span className="font-semibold text-gray-700">{f.score}/5</span> จาก {nameOf(f.from_user)} ·{' '}
                            {tasks.find((t) => t.task_id === f.task_id)?.title || 'งาน'}
                            {f.comment && <span className="block text-gray-500">“{f.comment}”</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })()}
          </div>
        ))}
      </div>

      <ul className="text-[11px] text-gray-400 space-y-0.5 list-disc pl-4">
        <li>
          ภาระงาน: น้ำหนักงานที่เสร็จ (ความสำคัญ ต่ำ 1–ด่วน 4 + ความยาก ง่าย 1–ยาก 3) แบ่งเท่ากันระหว่างคนหลักกับผู้ร่วมทำที่ตอบรับ
          เทียบกับส่วนแบ่งเฉลี่ยต่อคนของกลุ่ม
        </li>
        <li>ความตรงเวลา: สัดส่วนงานที่เสร็จทันกำหนดส่ง (ผู้ร่วมทำนับเหมือนคนหลัก)</li>
        <li>
          กิจกรรม: จำนวนความเห็น การตัดสินใจ และการแก้ลิงก์ผลงาน (นับไม่เกินวันละ {DAILY_ACTIVITY_CAP} ครั้ง)
          เทียบกับสมาชิกที่มีกิจกรรมมากที่สุด
        </li>
        <li>ความสม่ำเสมอ: จำนวนสัปดาห์ที่มีกิจกรรมใด ๆ เทียบกับจำนวนสัปดาห์ตั้งแต่เข้ากลุ่ม</li>
      </ul>
    </div>
  )
}
