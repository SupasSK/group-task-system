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
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-gray-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full gt-gradient-x" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="w-14 text-right text-xs font-semibold text-gray-600">
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
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-2">คะแนนการมีส่วนร่วม (เต็ม 100)</h2>
        <ul className="text-xs text-gray-500 space-y-1 list-disc pl-5">
          <li>
            ภาระงาน {MAX_WORKLOAD} คะแนน: คะแนนงานที่ทำเสร็จ (ต่ำ 1, กลาง 2, สูง 3, ด่วน 4)
            เทียบกับส่วนแบ่งเฉลี่ยต่อคนของกลุ่ม
          </li>
          <li>ความตรงเวลา {MAX_PUNCTUAL} คะแนน: สัดส่วนงานที่เสร็จทันกำหนดส่ง</li>
          <li>
            ความสม่ำเสมอ {MAX_CONSISTENCY} คะแนน: จำนวนวันที่มีกิจกรรมในกลุ่ม
            เทียบกับสมาชิกที่มีกิจกรรมมากวันที่สุด
          </li>
        </ul>
        {logError && (
          <p className="mt-3 text-xs text-rose-600">โหลดประวัติกิจกรรมไม่สำเร็จ: {logError}</p>
        )}
      </div>

      {rows.map((r) => (
        <div key={r.member.user_id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {r.member.full_name || r.member.email || 'ไม่ทราบชื่อ'}
              </p>
              <p className="text-xs text-gray-400">{r.member.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}</p>
            </div>
            <p className="text-2xl font-bold text-indigo-600">
              {r.total}
              <span className="text-sm font-normal text-gray-400"> /100</span>
            </p>
          </div>

          <div className="space-y-2">
            <ScoreBar label="ภาระงาน" value={r.workload} max={MAX_WORKLOAD} />
            <ScoreBar label="ความตรงเวลา" value={r.punctual} max={MAX_PUNCTUAL} />
            <ScoreBar label="ความสม่ำเสมอ" value={r.consistency} max={MAX_CONSISTENCY} />
          </div>

          <p className="mt-4 text-xs text-gray-500">
            เสร็จแล้ว {r.doneCount} งาน · คะแนนงาน {r.points} ({r.share}% ของทั้งกลุ่ม) · ทันกำหนด {r.onTime}/
            {r.doneCount} งาน · ปฏิเสธงาน {r.rejected} ครั้ง · มีกิจกรรม {r.days} วัน
          </p>
        </div>
      ))}
    </div>
  )
}
