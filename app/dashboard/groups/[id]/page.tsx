'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'

interface Group {
  group_id: string
  group_name: string
  description: string | null
  work_mode: string
  join_code: string
  created_by: string
}

interface Member {
  user_id: string
  role: string
  joined_at: string
  full_name: string | null
  email: string | null
}

interface Task {
  task_id: string
  group_id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'pending' | 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'rejected'
  assignment_type: 'leader_assign' | 'open_choice'
  assigned_to: string | null
  assigned_by: string | null
  deadline: string | null
  created_at: string
  updated_at: string
}

interface TaskResponse {
  response_id: string
  task_id: string
  user_id: string
  response: 'accepted' | 'rejected'
  note: string | null
  responded_at: string
}

type TabType = 'overview' | 'tasks' | 'members' | 'summary'

const PRIORITY_CONFIG: Record<Task['priority'], { label: string; className: string }> = {
  low: { label: 'ต่ำ', className: 'bg-slate-100 text-slate-700' },
  medium: { label: 'กลาง', className: 'bg-blue-100 text-blue-700' },
  high: { label: 'สูง', className: 'bg-amber-100 text-amber-800' },
  urgent: { label: 'ด่วน', className: 'bg-rose-100 text-rose-700 font-bold' },
}

const STATUS_CONFIG: Record<Task['status'], { label: string; className: string }> = {
  pending: { label: 'รอผู้รับ', className: 'bg-slate-100 text-slate-700' },
  assigned: { label: 'รอตอบรับ', className: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'รับแล้ว', className: 'bg-indigo-100 text-indigo-700' },
  in_progress: { label: 'กำลังทำ', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'เสร็จแล้ว', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'ถูกปฏิเสธ', className: 'bg-rose-100 text-rose-700' },
}

function formatThaiDateTime(dateStr: string | null) {
  if (!dateStr) return 'ไม่ระบุ'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [activeTab, setActiveTab] = useState<TabType>('overview')

  const [copied, setCopied] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMessage, setAddMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // ===== States สำหรับแท็บงาน =====
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskResponses, setTaskResponses] = useState<TaskResponse[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [taskActionMessage, setTaskActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  // ฟอร์มสร้างงาน
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createTaskLoading, setCreateTaskLoading] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium')
  const [newDeadline, setNewDeadline] = useState('')
  const [newAssignmentType, setNewAssignmentType] = useState<Task['assignment_type']>('leader_assign')
  const [newAssignedTo, setNewAssignedTo] = useState('')

  // โมดอลปฏิเสธงาน
  const [rejectModalTask, setRejectModalTask] = useState<Task | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectLoading, setRejectLoading] = useState(false)

  // โมดอลเปลี่ยนผู้รับผิดชอบงานที่ถูกปฏิเสธ
  const [reassignModalTask, setReassignModalTask] = useState<Task | null>(null)
  const [reassignMemberId, setReassignMemberId] = useState('')
  const [reassignLoading, setReassignLoading] = useState(false)

  const loadMembers = useCallback(async () => {
    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('user_id, role, joined_at')
      .eq('group_id', id)

    if (memberErr || !memberRows) return

    if (memberRows.length === 0) {
      setMembers([])
      return
    }

    const userIds = memberRows.map((m: { user_id: string }) => m.user_id)
    const { data: userRows } = await supabase
      .from('users')
      .select('user_id, full_name, email')
      .in('user_id', userIds)

    const userMap: Record<string, { full_name: string | null; email: string | null }> = {}
    for (const u of (userRows || [])) {
      userMap[u.user_id] = { full_name: u.full_name, email: u.email }
    }

    setMembers(
      memberRows.map((m: { user_id: string; role: string; joined_at: string }) => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        full_name: userMap[m.user_id]?.full_name ?? null,
        email: userMap[m.user_id]?.email ?? null,
      }))
    )
  }, [id, supabase])

  const loadTasks = useCallback(async () => {
    setTasksLoading(true)
    const { data: taskRows, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: false })

    if (taskErr) {
      setTaskActionMessage({ type: 'error', text: `โหลดรายการงานไม่สำเร็จ: ${taskErr.message}` })
      setTasksLoading(false)
      return
    }

    setTasks(taskRows || [])

    if (taskRows && taskRows.length > 0) {
      const taskIds = taskRows.map((t) => t.task_id)
      const { data: respRows, error: respErr } = await supabase
        .from('task_responses')
        .select('*')
        .in('task_id', taskIds)
        .order('responded_at', { ascending: false })

      if (!respErr && respRows) {
        setTaskResponses(respRows)
      }
    } else {
      setTaskResponses([])
    }

    setTasksLoading(false)
  }, [id, supabase])

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setCurrentUserId(user.id)

      const { data: groupData, error: groupErr } = await supabase
        .from('groups')
        .select('group_id, group_name, description, work_mode, join_code, created_by')
        .eq('group_id', id)
        .maybeSingle()

      if (groupErr || !groupData) {
        setNotFound(true)
        setLoading(false)
        return
      }

      setGroup(groupData)
      await loadMembers()
      await loadTasks()
      setLoading(false)
    }

    load()
  }, [id, router, supabase, loadMembers, loadTasks])

  const isLeader = members.some((m) => m.user_id === currentUserId && m.role === 'leader')

  const getUserDisplayName = (userId: string | null) => {
    if (!userId) return 'ยังไม่มีผู้รับ'
    const m = members.find((item) => item.user_id === userId)
    if (!m) return 'ไม่ทราบชื่อ'
    return m.full_name || m.email || 'ไม่ทราบชื่อ'
  }

  const getLatestRejection = (taskId: string) => {
    return taskResponses.find((r) => r.task_id === taskId && r.response === 'rejected')
  }

  const handleCopy = async () => {
    if (!group) return
    await navigator.clipboard.writeText(group.join_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleAddMember = async () => {
    const email = emailInput.trim()
    if (!email) {
      setAddMessage({ type: 'error', text: 'กรุณากรอกอีเมลก่อน' })
      return
    }

    setAddLoading(true)
    setAddMessage(null)

    // ค้นหาผู้ใช้ผ่าน RPC เท่านั้น (ห้ามอ่านตาราง users ตรงๆ)
    const { data: foundUsers, error: rpcErr } = await supabase.rpc('find_user_by_email', { p_email: email })

    if (rpcErr) {
      setAddMessage({ type: 'error', text: `ค้นหาผู้ใช้ไม่สำเร็จ: ${rpcErr.message}` })
      setAddLoading(false)
      return
    }

    if (!foundUsers || foundUsers.length === 0) {
      setAddMessage({ type: 'info', text: 'ไม่พบผู้ใช้นี้' })
      setAddLoading(false)
      return
    }

    const foundUser = foundUsers[0] as { user_id: string; full_name: string | null; email: string }

    if (members.some((m) => m.user_id === foundUser.user_id)) {
      setAddMessage({ type: 'info', text: 'เป็นสมาชิกของกลุ่มนี้แล้ว' })
      setAddLoading(false)
      return
    }

    const { error: insertErr } = await supabase
      .from('group_members')
      .insert({ group_id: id, user_id: foundUser.user_id, role: 'member' })

    if (insertErr) {
      setAddMessage({ type: 'error', text: `เพิ่มสมาชิกไม่สำเร็จ: ${insertErr.message}` })
      setAddLoading(false)
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'member_added',
      entityType: 'member',
      entityId: foundUser.user_id,
      payload: { role: 'member', email: foundUser.email },
    })

    setAddMessage({ type: 'success', text: `เพิ่ม ${foundUser.full_name || foundUser.email} เป็นสมาชิกสำเร็จ` })
    setEmailInput('')
    await loadMembers()
    setAddLoading(false)
  }

  // ===== ฟังก์ชันสร้างงานใหม่ (เฉพาะหัวหน้า) =====
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) {
      setTaskActionMessage({ type: 'error', text: 'กรุณาระบุชื่องาน' })
      return
    }

    if (newAssignmentType === 'leader_assign' && !newAssignedTo) {
      setTaskActionMessage({ type: 'error', text: 'กรุณาเลือกสมาชิกผู้รับผิดชอบงาน' })
      return
    }

    setCreateTaskLoading(true)
    setTaskActionMessage(null)

    const isoDeadline = newDeadline ? new Date(newDeadline).toISOString() : null
    const nowIso = new Date().toISOString()

    const taskPayload = {
      group_id: id,
      title: newTitle.trim(),
      description: newDescription.trim() || null,
      priority: newPriority,
      status: newAssignmentType === 'leader_assign' ? 'assigned' : 'pending',
      assignment_type: newAssignmentType,
      assigned_to: newAssignmentType === 'leader_assign' ? newAssignedTo : null,
      assigned_by: currentUserId,
      deadline: isoDeadline,
      updated_at: nowIso,
    }

    const { data: createdTask, error: insertErr } = await supabase
      .from('tasks')
      .insert(taskPayload)
      .select()
      .single()

    if (insertErr || !createdTask) {
      setTaskActionMessage({ type: 'error', text: `สร้างงานไม่สำเร็จ: ${insertErr?.message || 'เกิดข้อผิดพลาด'}` })
      setCreateTaskLoading(false)
      return
    }

    // บันทึก logActivity สำหรับ task_created
    await logActivity(supabase, {
      groupId: id,
      action: 'task_created',
      entityType: 'task',
      entityId: createdTask.task_id,
      payload: {
        title: createdTask.title,
        priority: createdTask.priority,
        deadline: createdTask.deadline,
      },
    })

    // ถ้าเป็น leader_assign ให้เรียก logActivity อีกครั้งสำหรับ task_assigned
    if (newAssignmentType === 'leader_assign') {
      await logActivity(supabase, {
        groupId: id,
        action: 'task_assigned',
        entityType: 'task',
        entityId: createdTask.task_id,
        payload: {
          title: createdTask.title,
          assigned_to: newAssignedTo,
          assignment_type: 'leader_assign',
        },
      })
    }

    setTaskActionMessage({ type: 'success', text: `สร้างงาน "${createdTask.title}" สำเร็จ` })
    setNewTitle('')
    setNewDescription('')
    setNewPriority('medium')
    setNewDeadline('')
    setNewAssignmentType('leader_assign')
    setNewAssignedTo('')
    setShowCreateModal(false)
    await loadTasks()
    setCreateTaskLoading(false)
  }

  // ===== ฟังก์ชันรับงาน =====
  const handleAcceptTask = async (task: Task) => {
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    // 1. ทำ update tasks ก่อนเสมอ
    const { error: updateErr } = await supabase
      .from('tasks')
      .update({ status: 'accepted', updated_at: nowIso })
      .eq('task_id', task.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `รับงานไม่สำเร็จ: ${updateErr.message}` })
      return
    }

    // 2. ถ้าสำเร็จ insert task_responses
    if (currentUserId) {
      await supabase.from('task_responses').insert({
        task_id: task.task_id,
        user_id: currentUserId,
        response: 'accepted',
      })
    }

    // 3. logActivity task_accepted
    await logActivity(supabase, {
      groupId: id,
      action: 'task_accepted',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title },
    })

    setTaskActionMessage({ type: 'success', text: `รับงาน "${task.title}" เรียบร้อยแล้ว` })
    await loadTasks()
  }

  // ===== ฟังก์ชันเลือกรับงานว่าง (open_choice) =====
  const handleClaimTask = async (task: Task) => {
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        assigned_to: currentUserId,
        status: 'in_progress',
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `เลือกรับงานไม่สำเร็จ: ${updateErr.message}` })
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'task_claimed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title },
    })

    setTaskActionMessage({ type: 'success', text: `เลือกรับงาน "${task.title}" แล้ว สถานะเปลี่ยนเป็นกำลังทำ` })
    await loadTasks()
  }

  // ===== ฟังก์ชันเริ่มทำงาน (เปลี่ยนจาก accepted เป็น in_progress) =====
  const handleStartTask = async (task: Task) => {
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'in_progress',
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `เริ่มทำงานไม่สำเร็จ: ${updateErr.message}` })
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, from: task.status, to: 'in_progress' },
    })

    setTaskActionMessage({ type: 'success', text: `เริ่มดำเนินงาน "${task.title}" แล้ว` })
    await loadTasks()
  }

  // ===== ฟังก์ชันยืนยันว่างานเสร็จแล้ว (เปลี่ยนเป็น completed) =====
  const handleCompleteTask = async (task: Task) => {
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `บันทึกงานเสร็จไม่สำเร็จ: ${updateErr.message}` })
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, from: task.status, to: 'completed' },
    })

    setTaskActionMessage({ type: 'success', text: `ยืนยันงาน "${task.title}" เสร็จสมบูรณ์แล้ว!` })
    await loadTasks()
  }

  // ===== ฟังก์ชันส่งการปฏิเสธงาน =====
  const handleConfirmReject = async () => {
    if (!rejectModalTask) return
    const reason = rejectReason.trim()
    if (!reason) {
      setTaskActionMessage({ type: 'error', text: 'กรุณากรอกเหตุผลในการปฏิเสธงาน' })
      return
    }

    setRejectLoading(true)
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    // 1. ทำ update tasks ก่อนเสมอ (ห้ามล้าง assigned_to)
    const { error: updateErr } = await supabase
      .from('tasks')
      .update({ status: 'rejected', updated_at: nowIso })
      .eq('task_id', rejectModalTask.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `ปฏิเสธงานไม่สำเร็จ: ${updateErr.message}` })
      setRejectLoading(false)
      return
    }

    // 2. ถ้าสำเร็จ insert task_responses
    if (currentUserId) {
      await supabase.from('task_responses').insert({
        task_id: rejectModalTask.task_id,
        user_id: currentUserId,
        response: 'rejected',
        note: reason,
      })
    }

    // 3. logActivity task_declined
    await logActivity(supabase, {
      groupId: id,
      action: 'task_declined',
      entityType: 'task',
      entityId: rejectModalTask.task_id,
      payload: { title: rejectModalTask.title, reason },
    })

    setTaskActionMessage({ type: 'info', text: `ปฏิเสธงาน "${rejectModalTask.title}" เรียบร้อยแล้ว` })
    setRejectModalTask(null)
    setRejectReason('')
    await loadTasks()
    setRejectLoading(false)
  }

  // ===== ฟังก์ชันเปลี่ยนผู้รับผิดชอบงานที่ถูกปฏิเสธ (เฉพาะหัวหน้า) =====
  const handleConfirmReassign = async () => {
    if (!reassignModalTask) return
    if (!reassignMemberId) {
      setTaskActionMessage({ type: 'error', text: 'กรุณาเลือกสมาชิกคนใหม่' })
      return
    }

    setReassignLoading(true)
    setTaskActionMessage(null)
    const nowIso = new Date().toISOString()

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        assigned_to: reassignMemberId,
        status: 'assigned',
        updated_at: nowIso,
      })
      .eq('task_id', reassignModalTask.task_id)

    if (updateErr) {
      setTaskActionMessage({ type: 'error', text: `เปลี่ยนผู้รับผิดชอบไม่สำเร็จ: ${updateErr.message}` })
      setReassignLoading(false)
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'task_assigned',
      entityType: 'task',
      entityId: reassignModalTask.task_id,
      payload: {
        title: reassignModalTask.title,
        assigned_to: reassignMemberId,
        assignment_type: 'leader_assign',
      },
    })

    setTaskActionMessage({
      type: 'success',
      text: `มอบหมายงาน "${reassignModalTask.title}" ให้กับ ${getUserDisplayName(reassignMemberId)} เรียบร้อยแล้ว`,
    })
    setReassignModalTask(null)
    setReassignMemberId('')
    await loadTasks()
    setReassignLoading(false)
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">กำลังโหลด...</div>
  }

  if (notFound || !group) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-600 mb-4">ไม่พบกลุ่มนี้ หรือคุณไม่ใช่สมาชิกของกลุ่ม</p>
        <button
          onClick={() => router.push('/dashboard/projects/new')}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:shadow-lg transition-all"
        >
          กลับไปหน้ากลุ่ม
        </button>
      </div>
    )
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'tasks', label: 'งาน' },
    { id: 'members', label: `สมาชิก (${members.length})` },
    { id: 'summary', label: 'สรุปผล' },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* ===== Header ===== */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => router.push('/dashboard/projects/new')}
          className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
        >
          ← กลับ
        </button>
      </div>

      {/* ===== ข้อมูลกลุ่ม ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{group.group_name}</h1>
            <p className="text-sm text-gray-500 mt-1">{group.description || 'ไม่มีรายละเอียด'}</p>
          </div>

          {/* รหัสเข้าร่วม */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-3 min-w-fit">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">รหัสเข้าร่วม</p>
              <p className="text-lg font-mono font-bold text-indigo-600 tracking-widest">{group.join_code}</p>
            </div>
            <button
              onClick={handleCopy}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
            >
              {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
            </button>
          </div>
        </div>
      </div>

      {/* ===== แถบแท็บ ===== */}
      <div className="flex gap-8 border-b border-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`-mb-px pb-3 text-[14px] transition-colors ${
              activeTab === item.id
                ? 'border-b-2 border-indigo-500 font-semibold text-indigo-600'
                : 'border-b-2 border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ===== แท็บ: ภาพรวม ===== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">ข้อมูลภาพรวมกลุ่ม</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400">รูปแบบการทำงาน</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{group.work_mode}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400">บทบาทของฉันในกลุ่ม</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">
                  {isLeader ? 'หัวหน้า' : 'สมาชิก'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-400">จำนวนสมาชิก</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{members.length} คน</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
            การสรุปการเปลี่ยนแปลงล่าสุดจะแสดงที่นี่
          </div>
        </div>
      )}

      {/* ===== แท็บ: งาน ===== */}
      {activeTab === 'tasks' && (
        <div className="space-y-6">
          {/* ข้อความแจ้งเตือนผลการดำเนินการ */}
          {taskActionMessage && (
            <div
              className={`px-4 py-3 rounded-xl text-sm ${
                taskActionMessage.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : taskActionMessage.type === 'error'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}
            >
              {taskActionMessage.text}
            </div>
          )}

          {/* ส่วนหัวของแท็บงาน พร้อมปุ่มสร้างงาน (เฉพาะหัวหน้า) */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-gray-800">รายการงานในกลุ่ม ({tasks.length})</h2>
              <p className="text-xs text-gray-500 mt-0.5">ติดตามสถานะ มอบหมาย และส่งต่องานในกลุ่ม</p>
            </div>
            {isLeader && (
              <button
                onClick={() => {
                  setTaskActionMessage(null)
                  setShowCreateModal(true)
                }}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:shadow-md transition-all whitespace-nowrap cursor-pointer"
              >
                + สร้างงาน
              </button>
            )}
          </div>

          {/* กล่อง/ฟอร์มสร้างงานใหม่ (เฉพาะหัวหน้า) */}
          {showCreateModal && (
            <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-base font-bold text-gray-800">สร้างงานใหม่</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-sm"
                >
                  ✕ ปิด
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ชื่องาน <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="เช่น ออกแบบหน้าหลัก, ตรวจสอบระบบฐานข้อมูล"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">รายละเอียดงาน</label>
                  <textarea
                    rows={3}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="รายละเอียดเพิ่มเติมของงาน..."
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">ความสำคัญ</label>
                    <select
                      value={newPriority}
                      onChange={(e) => setNewPriority(e.target.value as Task['priority'])}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                    >
                      <option value="low">ต่ำ (low)</option>
                      <option value="medium">กลาง (medium)</option>
                      <option value="high">สูง (high)</option>
                      <option value="urgent">ด่วน (urgent)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">กำหนดส่ง (Deadline)</label>
                    <input
                      type="datetime-local"
                      value={newDeadline}
                      onChange={(e) => setNewDeadline(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">โหมดมอบหมายงาน</label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="assignment_type"
                        value="leader_assign"
                        checked={newAssignmentType === 'leader_assign'}
                        onChange={() => setNewAssignmentType('leader_assign')}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>หัวหน้ามอบหมาย</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="assignment_type"
                        value="open_choice"
                        checked={newAssignmentType === 'open_choice'}
                        onChange={() => {
                          setNewAssignmentType('open_choice')
                          setNewAssignedTo('')
                        }}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>เปิดให้สมาชิกเลือกเอง</span>
                    </label>
                  </div>
                </div>

                {newAssignmentType === 'leader_assign' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      เลือกผู้รับผิดชอบ <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={newAssignedTo}
                      onChange={(e) => setNewAssignedTo(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                      required
                    >
                      <option value="">-- กรุณาเลือกสมาชิก --</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email} ({m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={createTaskLoading}
                    className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:shadow-md transition disabled:opacity-50"
                  >
                    {createTaskLoading ? 'กำลังสร้าง...' : 'บันทึกสร้างงาน'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* รายการงาน */}
          {tasksLoading ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 text-sm">
              กำลังโหลดรายการงาน...
            </div>
          ) : tasks.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400 text-sm">
              ยังไม่มีงานในกลุ่มนี้
            </div>
          ) : (
            <div className="space-y-4">
              {tasks.map((t) => {
                const priorityInfo = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium
                const statusInfo = STATUS_CONFIG[t.status] || STATUS_CONFIG.pending
                const isAssignee = t.assigned_to === currentUserId
                const isAwaitingResponse = t.assignment_type === 'leader_assign' && isAssignee && t.status === 'assigned'
                const latestRejection = t.status === 'rejected' ? getLatestRejection(t.task_id) : null

                return (
                  <div
                    key={t.task_id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3 hover:border-indigo-100 transition"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-gray-800">{t.title}</h3>
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${priorityInfo.className}`}>
                            ความสำคัญ: {priorityInfo.label}
                          </span>
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${statusInfo.className}`}>
                            {statusInfo.label}
                          </span>
                        </div>
                        {t.description && (
                          <p className="text-xs text-gray-600 leading-relaxed mt-1">{t.description}</p>
                        )}
                      </div>

                      <div className="text-right text-xs space-y-1 min-w-fit">
                        <p className="text-gray-500">
                          กำหนดส่ง: <span className="font-semibold text-gray-700">{formatThaiDateTime(t.deadline)}</span>
                        </p>
                        <p className="text-gray-500">
                          ผู้รับผิดชอบ:{' '}
                          <span className="font-semibold text-indigo-700">
                            {getUserDisplayName(t.assigned_to)}
                            {isAssignee && <span className="text-gray-400 ml-1">(คุณ)</span>}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* แสดงกรณีถูกปฏิเสธ (rejected): ห้ามล้าง assigned_to แสดงป้ายปฏิเสธโดย พร้อมเหตุผล */}
                    {t.status === 'rejected' && (
                      <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-800 flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-semibold">
                            ปฏิเสธโดย {getUserDisplayName(latestRejection?.user_id || t.assigned_to)}
                          </span>
                          {latestRejection?.note && (
                            <span className="ml-2 text-rose-600">
                              (เหตุผล: {latestRejection.note})
                            </span>
                          )}
                        </div>
                        {/* หัวหน้าเห็นปุ่มเปลี่ยนผู้รับผิดชอบ */}
                        {isLeader && (
                          <button
                            onClick={() => {
                              setTaskActionMessage(null)
                              setReassignModalTask(t)
                              setReassignMemberId('')
                            }}
                            className="px-3 py-1 bg-white border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold hover:bg-rose-100 transition whitespace-nowrap cursor-pointer"
                          >
                            เปลี่ยนผู้รับผิดชอบ
                          </button>
                        )}
                      </div>
                    )}

                    {/* ปุ่มการกระทำสำหรับสมาชิก */}
                    {/* 1. กรณีงานว่าง (open_choice) ที่ยังไม่มีผู้รับ */}
                    {t.assignment_type === 'open_choice' && t.status === 'pending' && !t.assigned_to && (
                      <div className="pt-2 border-t border-gray-100 flex items-center justify-end">
                        <button
                          onClick={() => handleClaimTask(t)}
                          className="px-4 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-xs font-semibold hover:shadow-md transition cursor-pointer"
                        >
                          เลือกรับงานนี้
                        </button>
                      </div>
                    )}

                    {/* 2. การตอบรับงาน (เฉพาะผู้ใช้ที่เป็น assigned_to และงานมี status = 'assigned') */}
                    {isAwaitingResponse && (
                      <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleAcceptTask(t)}
                          className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer"
                        >
                          รับงาน
                        </button>
                        <button
                          onClick={() => {
                            setTaskActionMessage(null)
                            setRejectModalTask(t)
                            setRejectReason('')
                          }}
                          className="px-4 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold hover:bg-rose-100 transition cursor-pointer"
                        >
                          ปฏิเสธ
                        </button>
                      </div>
                    )}

                    {/* 3. การดำเนินงานและส่งงาน (เมื่อผู้ใช้รับงานแล้ว หรือกำลังทำ) */}
                    {isAssignee && (t.status === 'accepted' || t.status === 'in_progress') && (
                      <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
                        {t.status === 'accepted' && (
                          <button
                            onClick={() => handleStartTask(t)}
                            className="px-4 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition cursor-pointer"
                          >
                            เริ่มทำงาน
                          </button>
                        )}
                        <button
                          onClick={() => handleCompleteTask(t)}
                          className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer"
                        >
                          ✅ ทำเสร็จแล้ว
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* กล่องโมดอลสำหรับปฏิเสธงาน (ต้องกรอกเหตุผล) */}
          {rejectModalTask && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
                <h3 className="text-base font-bold text-gray-800">
                  ปฏิเสธงาน: {rejectModalTask.title}
                </h3>
                <p className="text-xs text-gray-500">
                  กรุณากรอกเหตุผลในการปฏิเสธงานนี้ เพื่อแจ้งให้หัวหน้ากลุ่มทราบ
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    เหตุผลในการปฏิเสธ <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="เช่น ภาระงานปัจจุบันเต็มแล้ว, ทักษะไม่ตรง..."
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectModalTask(null)
                      setRejectReason('')
                    }}
                    className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReject}
                    disabled={rejectLoading || !rejectReason.trim()}
                    className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition disabled:opacity-50"
                  >
                    {rejectLoading ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธงาน'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* กล่องโมดอลสำหรับเปลี่ยนผู้รับผิดชอบงานที่ถูกปฏิเสธ (หัวหน้า) */}
          {reassignModalTask && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
                <h3 className="text-base font-bold text-gray-800">
                  เปลี่ยนผู้รับผิดชอบ: {reassignModalTask.title}
                </h3>
                <p className="text-xs text-gray-500">
                  เลือกสมาชิกคนใหม่เพื่อมอบหมายงานนี้อีกครั้ง
                </p>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    เลือกสมาชิกคนใหม่ <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={reassignMemberId}
                    onChange={(e) => setReassignMemberId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  >
                    <option value="">-- กรุณาเลือกสมาชิก --</option>
                    {members
                      .filter((m) => m.user_id !== reassignModalTask.assigned_to)
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email} ({m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReassignModalTask(null)
                      setReassignMemberId('')
                    }}
                    className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReassign}
                    disabled={reassignLoading || !reassignMemberId}
                    className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-xs font-semibold hover:shadow-md transition disabled:opacity-50"
                  >
                    {reassignLoading ? 'กำลังบันทึก...' : 'มอบหมายงานใหม่'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== แท็บ: สมาชิก ===== */}
      {activeTab === 'members' && (
        <div className="space-y-6">
          {/* เพิ่มสมาชิก (หัวหน้าเท่านั้น) */}
          {isLeader && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">เพิ่มสมาชิกด้วยอีเมล</h2>
              <div className="flex gap-3">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
                  placeholder="example@email.com"
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={addLoading}
                />
                <button
                  onClick={handleAddMember}
                  disabled={addLoading}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:shadow-lg transition-all disabled:opacity-50 text-sm whitespace-nowrap"
                >
                  {addLoading ? 'กำลังเพิ่ม...' : 'เพิ่มสมาชิก'}
                </button>
              </div>

              {addMessage && (
                <div
                  className={`mt-3 px-4 py-2.5 rounded-xl text-sm ${
                    addMessage.type === 'success'
                      ? 'bg-green-50 text-green-700 border border-green-100'
                      : addMessage.type === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-100'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-100'
                  }`}
                >
                  {addMessage.text}
                </div>
              )}
            </div>
          )}

          {/* รายการสมาชิก */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              สมาชิก ({members.length} คน)
            </h2>

            {members.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มีสมาชิก</p>
            ) : (
              <ul className="space-y-3">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {m.full_name || m.email || 'ไม่ทราบชื่อ'}
                        {m.user_id === currentUserId && (
                          <span className="ml-2 text-xs text-gray-400">(คุณ)</span>
                        )}
                      </p>
                      {m.full_name && (
                        <p className="text-xs text-gray-400">{m.email}</p>
                      )}
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${
                        m.role === 'leader'
                          ? 'bg-indigo-100 text-indigo-700 font-semibold'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {m.role === 'leader' ? '👑 หัวหน้า' : '👤 สมาชิก'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== แท็บ: สรุปผล ===== */}
      {activeTab === 'summary' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-gray-500 text-sm">
          คะแนนการมีส่วนร่วมและประวัติกิจกรรมจะแสดงที่นี่
        </div>
      )}
    </div>
  )
}
