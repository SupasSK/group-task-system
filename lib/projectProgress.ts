// ความคืบหน้าของโครงการ (0-100) = จำนวนงานที่เสร็จแล้ว เทียบกับจำนวนงานทั้งหมดในกลุ่ม
export function projectProgress(tasks: { status: string }[]) {
  if (tasks.length === 0) return 0
  const done = tasks.filter((t) => t.status === 'completed').length
  return Math.round((done / tasks.length) * 100)
}
