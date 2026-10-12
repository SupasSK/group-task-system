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

export default function ParticipationSummary({
  groupId,
  members,
  tasks,
  taskResponses,
}: {
  groupId: string
  members: Member[]
  tasks: Task[]
  taskResponses: TaskResponse[]
}) {
  const supabase = createClient()
  // จำนวนวันที่สมาชิกแต่ละคนมีกิจกรรมในกลุ่ม
  const [activeDays, setActiveDays] = useState<Record<string, number>>({})
  const [logError, setLogError] = useState<string | null>(null)

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
