'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase'
import { useRouter } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'

export default function ProjectsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    group_name: '',
    description: '',
    work_mode: 'mixed'
  })

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data, error } = await supabase
      .from('groups')
      .select(`
        group_id,
        group_name,
        description,
        work_mode,
        join_code,
        created_at,
        created_by,
        group_members!inner(role)
      `)
      .eq('group_members.user_id', user.id)
      .order('created_at', { ascending: false })

    if (!error) setProjects(data || [])
    setLoading(false)
  }

  const generateJoinCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert('กรุณาเข้าสู่ระบบก่อน')
      setLoading(false)
      return
    }

    const joinCode = generateJoinCode()

    // 1. สร้างกลุ่ม
    const { data: group, error: groupErr } = await (supabase
      .from('groups') as any)
      .insert({
        group_name: form.group_name,
        description: form.description,
        work_mode: form.work_mode,
        join_code: joinCode,
        created_by: user.id
      })
      .select()
      .single()

    if (groupErr || !group) {
      alert('สร้างกลุ่มไม่สำเร็จ: ' + (groupErr?.message || 'ไม่พบข้อมูลกลุ่ม'))
      setLoading(false)
      return
    }

    // 2. เพิ่มผู้สร้างเป็นหัวหน้ากลุ่ม
    const { error: memberErr } = await (supabase
      .from('group_members') as any)
      .insert({
        group_id: (group as any).group_id,
        user_id: user.id,
        role: 'leader'
      })

    if (memberErr) {
      alert('เพิ่มสมาชิกไม่สำเร็จ: ' + memberErr.message)
      setLoading(false)
      return
    }

    await logActivity(supabase, {
      groupId: group.group_id,
      action: 'group_created',
      entityType: 'group',
      entityId: group.group_id,
      payload: { group_name: form.group_name, work_mode: form.work_mode },
    })
    await logActivity(supabase, {
      groupId: group.group_id,
      action: 'member_added',
      entityType: 'member',
      entityId: user.id,
      payload: { role: 'leader' },
    })

    alert(`✅ สร้างกลุ่มสำเร็จ!\nรหัสเข้าร่วม: ${joinCode}`)
    setShowModal(false)
    setForm({ group_name: '', description: '', work_mode: 'mixed' })
    loadProjects()
  }

  if (loading && projects.length === 0) {
    return <div className="p-8 text-center">กำลังโหลด...</div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-800">โครงการ/กลุ่มของฉัน</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:shadow-lg transition-all"
        >
          + สร้างกลุ่มใหม่
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">ยังไม่มีกลุ่ม</p>
          <p className="text-sm mt-1">กดปุ่มด้านบนเพื่อสร้างกลุ่มแรกของคุณ</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((g) => (
            <div
              key={g.group_id}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-all cursor-pointer"
              onClick={() => router.push(`/dashboard/groups/${g.group_id}`)}
            >
              <h3 className="text-lg font-semibold text-gray-800">{g.group_name}</h3>
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{g.description || 'ไม่มีรายละเอียด'}</p>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
                  {g.group_members?.[0]?.role === 'leader' ? '👑 หัวหน้า' : '👤 สมาชิก'}
                </span>
                <span className="text-xs text-gray-400">
                  {g.work_mode === 'leader_all' && 'หัวหน้าคุม'}
                  {g.work_mode === 'member_choose' && 'สมาชิกเลือก'}
                  {g.work_mode === 'mixed' && 'แบบผสม'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== MODAL สร้างกลุ่ม ===== */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6">สร้างกลุ่มใหม่</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อกลุ่ม *</label>
                <input
                  type="text"
                  required
                  value={form.group_name}
                  onChange={(e) => setForm({...form, group_name: e.target.value})}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="เช่น โปรเจกต์วิทยานิพนธ์"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียด</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({...form, description: e.target.value})}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="คำอธิบายกลุ่ม"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">รูปแบบการทำงาน</label>
                <select
                  value={form.work_mode}
                  onChange={(e) => setForm({...form, work_mode: e.target.value})}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="leader_all">หัวหน้าคุมทั้งหมด — มอบหมายงานให้คนอื่น</option>
                  <option value="member_choose">สมาชิกเลือกเอง — เปิดรายการให้เลือก</option>
                  <option value="mixed">แบบผสมผสาน — ทั้งสองแบบ</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {loading ? 'กำลังสร้าง...' : 'สร้างกลุ่ม'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}