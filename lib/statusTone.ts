// ชุดสีสถานะ — ใช้ชุดเดียวทั้งระบบ
// ฟ้า = กำลังทำ, เหลือง/ส้ม = รอตอบรับ, เขียว = เสร็จ, แดง = เลยกำหนด, เทา = ว่าง/ปฏิเสธ
// สีม่วงสงวนไว้ให้ปุ่มหลัก เมนูที่เลือก และป้ายหัวหน้าเท่านั้น
export type Tone = 'doing' | 'waiting' | 'done' | 'overdue' | 'neutral'

interface ToneTask {
  status: string
  deadline: string | null
}

export function isOverdue(t: ToneTask, now = new Date()) {
  return !!t.deadline && new Date(t.deadline) < now && t.status !== 'completed' && t.status !== 'rejected'
}

// invite = มีคำเชิญเป็นผู้ร่วมทำที่ฉันยังไม่ได้ตอบ
export function toneOf(t: ToneTask, invite = false, now = new Date()): Tone {
  if (isOverdue(t, now)) return 'overdue'
  if (t.status === 'completed') return 'done'
  if (t.status === 'assigned' || invite) return 'waiting'
  if (t.status === 'accepted' || t.status === 'in_progress') return 'doing'
  return 'neutral'
}

export const TONE: Record<Tone, { label: string; badge: string; dot: string }> = {
  doing: { label: 'กำลังทำ', badge: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  waiting: { label: 'รอตอบรับ', badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  done: { label: 'เสร็จแล้ว', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  overdue: { label: 'เลยกำหนด', badge: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
  neutral: { label: 'ยังไม่มีคนทำ', badge: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
}
