// น้ำหนักงาน = ความสำคัญ (ต่ำ 1, กลาง 2, สูง 3, ด่วน 4) + ความยาก (ง่าย 1, กลาง 2, ยาก 3)
const PRIORITY_POINTS: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 4 }
const DIFFICULTY_POINTS: Record<string, number> = { easy: 1, medium: 2, hard: 3 }

interface WeightedTask {
  task_id: string
  priority: string
  difficulty?: string | null
  status: string
  assigned_to: string | null
}

interface TeamCollaborator {
  task_id: string
  user_id: string
  status: string
}

export function taskWeight(task: { priority: string; difficulty?: string | null }) {
  return (PRIORITY_POINTS[task.priority] ?? 2) + (DIFFICULTY_POINTS[task.difficulty ?? 'medium'] ?? 2)
}

// คนที่อยู่ในงาน: ผู้รับผิดชอบหลัก + ผู้ร่วมทำที่ยังไม่ปฏิเสธ (accepted เท่านั้น ถ้า acceptedOnly)
export function taskTeam(task: WeightedTask, collaborators: TeamCollaborator[], acceptedOnly = false) {
  const others = collaborators
    .filter((c) => c.task_id === task.task_id && (acceptedOnly ? c.status === 'accepted' : c.status !== 'rejected'))
    .map((c) => c.user_id)
  return task.assigned_to ? [task.assigned_to, ...others] : others
}

// งานที่ยังไม่เสร็จของแต่ละคน และภาระรวม (น้ำหนักงานหารด้วยจำนวนคนในงาน)
export function openWorkload<T extends WeightedTask>(userId: string, tasks: T[], collaborators: TeamCollaborator[]) {
  const items = tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'rejected')
    .map((t) => ({ task: t, team: taskTeam(t, collaborators) }))
    .filter(({ team }) => team.includes(userId))
    .map(({ task, team }) => ({
      task,
      role: task.assigned_to === userId ? ('main' as const) : ('collaborator' as const),
      load: taskWeight(task) / team.length,
    }))
  return { items, load: items.reduce((sum, i) => sum + i.load, 0) }
}
