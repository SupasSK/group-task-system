'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'

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
  status: string
  assigned_to: string | null
  deadline: string | null
  completed_at?: string | null
}

interface TaskResponse {
  user_id: string
  response: string
}

// น้ำหนักงานตามระดับความสำคัญ
const PRIORITY_WEIGHT: Record<Task['priority'], number> = { low: 1, medium: 2, high: 3, urgent: 4 }

// คะแนนเต็มของแต่ละองค์ประกอบ (รวม 100)
const MAX_WORKLOAD = 50
const MAX_PUNCTUAL = 30
const MAX_CONSISTENCY = 20

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
  members,
  tasks,
  taskResponses,
  showPeerEval = false,
}: {
  groupId: string
  members: Member[]
  tasks: Task[]
  taskResponses: TaskResponse[]
  // แสดงผลประเมินเพื่อน (ฐานข้อมูลคืนผลให้เฉพาะหัวหน้า คนอื่นจะไม่เห็นส่วนนี้)
  showPeerEval?: boolean
}) {
  const supabase = createClient()
  // จำนวนวันที่สมาชิกแต่ละคนมีกิจกรรมในกลุ่ม
  const [activeDays, setActiveDays] = useState<Record<string, number>>({})
  const [logError, setLogError] = useState<string | null>(null)
  // ค่าเฉลี่ยผลประเมินเพื่อนจากทุกรอบที่ปิดแล้ว (null = ไม่มีสิทธิ์ดู หรือยังไม่โหลด)
  const [peerAverages, setPeerAverages] = useState<Record<string, PeerAverage> | null>(null)
  // ฟีดแบคแบบเปิดชื่อจากงานที่ทำร่วมกัน (RLS ให้หัวหน้าอ่านได้ทั้งกลุ่ม)
  const [feedback, setFeedback] = useState<TaskFeedback[]>([])
  const [openFeedbackFor, setOpenFeedbackFor] = useState<string | null>(null)

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
    const loadActiveDays = async () => {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('actor_id, created_at')
        .eq('group_id', groupId)

      if (error) {
        setLogError(error.message)
        return
      }

      const days: Record<string, Set<string>> = {}
      for (const log of data || []) {
        if (!days[log.actor_id]) days[log.actor_id] = new Set()
        days[log.actor_id].add(new Date(log.created_at).toDateString())
      }
      const counts: Record<string, number> = {}
      for (const userId of Object.keys(days)) counts[userId] = days[userId].size
      setActiveDays(counts)
      setLogError(null)
    }

    loadActiveDays()
  }, [groupId, supabase, tasks])

  if (members.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-500 text-sm">
        ยังไม่มีสมาชิกในกลุ่ม
      </div>
    )
  }

  const stats = members.map((m) => {
    const done = tasks.filter((t) => t.assigned_to === m.user_id && t.status === 'completed')
    const points = done.reduce((sum, t) => sum + (PRIORITY_WEIGHT[t.priority] ?? 0), 0)
    const onTime = done.filter(
      (t) => !t.deadline || (t.completed_at && new Date(t.completed_at) <= new Date(t.deadline))
    ).length
    const rejected = taskResponses.filter((r) => r.user_id === m.user_id && r.response === 'rejected').length
    return { member: m, doneCount: done.length, points, onTime, rejected, days: activeDays[m.user_id] ?? 0 }
  })

  const totalPoints = stats.reduce((sum, s) => sum + s.points, 0)
  const fairShare = totalPoints / members.length
  const maxDays = Math.max(...stats.map((s) => s.days))

  const rows = stats
    .map((s) => {
      const workload = fairShare > 0 ? MAX_WORKLOAD * Math.min(1, s.points / fairShare) : 0
      const punctual = s.doneCount > 0 ? (MAX_PUNCTUAL * s.onTime) / s.doneCount : 0
      const consistency = maxDays > 0 ? (MAX_CONSISTENCY * s.days) / maxDays : 0
      const share = totalPoints > 0 ? Math.round((s.points / totalPoints) * 100) : 0
      return { ...s, workload, punctual, consistency, share, total: Math.round(workload + punctual + consistency) }
    })
    .sort((a, b) => b.total - a.total)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-800">คะแนนการมีส่วนร่วม (เต็ม 100)</h2>
        <p className="mt-1 text-xs text-gray-500">
          ภาระงาน {MAX_WORKLOAD} + ความตรงเวลา {MAX_PUNCTUAL} + ความสม่ำเสมอ {MAX_CONSISTENCY}
        </p>
        {logError && (
          <p className="mt-2 text-xs text-rose-600">โหลดประวัติกิจกรรมไม่สำเร็จ: {logError}</p>
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
              <ScoreBar label="สม่ำเสมอ" value={r.consistency} max={MAX_CONSISTENCY} />
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">เสร็จ {r.doneCount} งาน</span>
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700">{r.share}% ของกลุ่ม</span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                ทันกำหนด {r.onTime}/{r.doneCount}
              </span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">ปฏิเสธ {r.rejected}</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">มีกิจกรรม {r.days} วัน</span>
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
                      <span className="text-indigo-600">{open ? 'ซ่อน' : 'ดูรายละเอียด'}</span>
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
        <li>ภาระงาน: คะแนนงานที่เสร็จ (ต่ำ 1, กลาง 2, สูง 3, ด่วน 4) เทียบกับส่วนแบ่งเฉลี่ยต่อคนของกลุ่ม</li>
        <li>ความตรงเวลา: สัดส่วนงานที่เสร็จทันกำหนดส่ง</li>
        <li>ความสม่ำเสมอ: จำนวนวันที่มีกิจกรรม เทียบกับสมาชิกที่มีกิจกรรมมากวันที่สุด</li>
      </ul>
    </div>
  )
}
