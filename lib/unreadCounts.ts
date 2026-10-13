import type { SupabaseClient } from '@supabase/supabase-js'

// นับกิจกรรมของสมาชิกคนอื่นที่เกิดหลังจากผู้ใช้เข้าดูแต่ละกลุ่มครั้งล่าสุด
// คืนค่าเป็น { group_id: จำนวน } เฉพาะกลุ่มที่มีกิจกรรมใหม่
export async function loadUnreadCounts(supabase: SupabaseClient, userId: string) {
  const { data: visits } = await supabase
    .from('group_visits')
    .select('group_id, last_seen_at')
    .eq('user_id', userId)

  const lastSeen: Record<string, string> = {}
  for (const v of visits || []) lastSeen[v.group_id] = v.last_seen_at

  // RLS จำกัดให้เห็นเฉพาะ log ของกลุ่มที่ตนเองเป็นสมาชิกอยู่แล้ว
  const { data: logs } = await supabase
    .from('activity_logs')
    .select('group_id, created_at')
    .neq('actor_id', userId)
    .order('created_at', { ascending: false })
    .limit(500)

  const counts: Record<string, number> = {}
  for (const log of logs || []) {
    const seen = lastSeen[log.group_id]
    if (!seen || new Date(log.created_at) > new Date(seen)) {
      counts[log.group_id] = (counts[log.group_id] || 0) + 1
    }
  }
  return counts
}
