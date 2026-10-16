'use client'
import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase'

// แถบเตือนเมื่อการตรวจสายบันทึกกิจกรรมอัตโนมัติรายวันครั้งล่าสุดพบความผิดปกติ (supabase-integrity-checks.sql)
export default function IntegrityAlert({ groupId }: { groupId: string }) {
  const supabase = createClient()
  const [broken, setBroken] = useState<{ seq: number | null; at: string } | null>(null)

  useEffect(() => {
    supabase
      .from('integrity_checks')
      .select('is_valid, broken_at_seq, checked_at')
      .eq('group_id', groupId)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setBroken(data && !data.is_valid ? { seq: data.broken_at_seq, at: data.checked_at } : null))
  }, [groupId, supabase])

  if (!broken) return null
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <p>
        <span className="font-semibold">ตรวจพบว่าประวัติกิจกรรมของกลุ่มนี้ถูกแก้ไขหรือลบ</span>
        {broken.seq !== null && ` (เริ่มผิดปกติที่ลำดับ ${broken.seq})`} จากการตรวจอัตโนมัติเมื่อ{' '}
        {new Date(broken.at).toLocaleString('th-TH')} กรุณาแจ้งอาจารย์ผู้ดูแลรายวิชา
      </p>
    </div>
  )
}
