// ความคืบหน้าของโครงการ (0-100) = ค่าเฉลี่ยความคืบหน้าของทุกงานในกลุ่ม
// งานที่เสร็จแล้วนับ 100% งานอื่นใช้ค่า progress ที่ผู้รับงานรายงาน
export function projectProgress(tasks: { status: string; progress?: number | null }[]) {
  if (tasks.length === 0) return 0
  const sum = tasks.reduce((total, t) => total + (t.status === 'completed' ? 100 : t.progress ?? 0), 0)
  return Math.round(sum / tasks.length)
}
