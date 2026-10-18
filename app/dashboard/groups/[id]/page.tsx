'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { projectProgress } from '@/lib/projectProgress'
import { openWorkload, taskTeam } from '@/lib/workload'
import { toneOf, TONE } from '@/lib/statusTone'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'
import ParticipationSummary from '@/components/dashboard/ParticipationSummary'
import CatchUpDigest from '@/components/dashboard/CatchUpDigest'
import IntegrityAlert from '@/components/dashboard/IntegrityAlert'
import TaskWorkPanel from '@/components/dashboard/TaskWorkPanel'
import PeerEvaluation from '@/components/dashboard/PeerEvaluation'
import TaskTeamPanel, { type Collaborator } from '@/components/dashboard/TaskTeamPanel'
import TaskEditModal from '@/components/dashboard/TaskEditModal'
import UserAvatar from '@/components/ui/UserAvatar'
import { ArrowLeft, Check, CircleCheck, Copy, Crown, Pencil, Plus, Trash2, User, X } from 'lucide-react'

interface Group {
  group_id: string
  group_name: string
  description: string | null
  work_mode: string
  join_code: string
  created_by: string
  pending_leader_id: string | null
  archived_at: string | null
}

interface Member {
  user_id: string
  role: string
  joined_at: string
  full_name: string | null
  email: string | null
  avatar: string | null
}

interface Task {
  task_id: string
  group_id: string
  title: string
  description: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  difficulty: 'easy' | 'medium' | 'hard'
  headcount: number
  status: 'pending' | 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'rejected'
  assignment_type: 'leader_assign' | 'open_choice'
  assigned_to: string | null
  assigned_by: string | null
  deadline: string | null
  work_url?: string | null
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

type TabType = 'overview' | 'tasks' | 'members' | 'summary' | 'evaluation'

const DIFFICULTY_LABEL: Record<Task['difficulty'], string> = { easy: 'ง่าย', medium: 'กลาง', hard: 'ยาก' }

const PRIORITY_CONFIG: Record<Task['priority'], { label: string; className: string }> = {
  low: { label: 'ต่ำ', className: 'bg-slate-100 text-slate-700' },
  medium: { label: 'กลาง', className: 'bg-blue-100 text-blue-700' },
  high: { label: 'สูง', className: 'bg-amber-100 text-amber-800' },
  urgent: { label: 'ด่วน', className: 'bg-rose-100 text-rose-700 font-bold' },
}

// สีตามชุดสีสถานะใน lib/statusTone.ts
const STATUS_CONFIG: Record<Task['status'], { label: string; className: string }> = {
  pending: { label: 'รอผู้รับ', className: TONE.neutral.badge },
  assigned: { label: 'รอตอบรับ', className: TONE.waiting.badge },
  accepted: { label: 'รับแล้ว', className: TONE.doing.badge },
  in_progress: { label: 'กำลังทำ', className: TONE.doing.badge },
  completed: { label: 'เสร็จแล้ว', className: TONE.done.badge },
  rejected: { label: 'ถูกปฏิเสธ', className: TONE.neutral.badge },
}

// คอลัมน์ของบอร์ดงาน
const BOARD_COLUMNS: { key: string; title: string; pill: string; statuses: Task['status'][] }[] = [
  { key: 'todo', title: 'รอเริ่ม', pill: 'bg-slate-200 text-slate-800', statuses: ['pending', 'assigned', 'accepted', 'rejected'] },
  { key: 'doing', title: 'กำลังทำ', pill: TONE.doing.badge, statuses: ['in_progress'] },
  { key: 'done', title: 'เสร็จแล้ว', pill: TONE.done.badge, statuses: ['completed'] },
]

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
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
  // โหลดไม่สำเร็จเพราะเชื่อมต่อไม่ได้ (ไม่ใช่ไม่พบกลุ่ม)
  const [loadFailed, setLoadFailed] = useState(false)

  // เปิดแท็บตามพารามิเตอร์ ?tab= (เช่น มาจากปุ่มสร้างงานในหน้าหัวหน้า)
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const tab = searchParams.get('tab')
    return tab === 'tasks' || tab === 'members' || tab === 'summary' || tab === 'evaluation' ? tab : 'overview'
  })

  const [copied, setCopied] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMessage, setAddMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  // สมาชิกที่หัวหน้ากำลังยืนยันจะนำออก
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  // สมาชิกกำลังยืนยันจะออกจากกลุ่มเอง
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  // สมาชิกที่หัวหน้ากำลังยืนยันจะเสนอให้เป็นหัวหน้า
  const [transferConfirmId, setTransferConfirmId] = useState<string | null>(null)
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferMessage, setTransferMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // หัวหน้าต้องพิมพ์ชื่อกลุ่มให้ตรงก่อนลบ
  const [deleteGroupText, setDeleteGroupText] = useState('')
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false)
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null)

  // ===== States สำหรับแท็บงาน =====
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskResponses, setTaskResponses] = useState<TaskResponse[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [taskActionMessage, setTaskActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  // งานที่เปิดดูรายละเอียดในหน้าต่าง ?task=<id> เปิดงานนั้นทันที (มาจากหน้าหลักหรือปฏิทิน)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get('task'))
  const [boardFilter, setBoardFilter] = useState<'all' | 'mine' | 'open'>('all')

  // ฟอร์มสร้างงาน
  // ?new=1 เปิดฟอร์มสร้างงานทันที (มาจากปุ่มสร้างงานในหน้าหัวหน้า)
  const [showCreateModal, setShowCreateModal] = useState(() => searchParams.get('new') === '1')
  const [createTaskLoading, setCreateTaskLoading] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium')
  const [newDifficulty, setNewDifficulty] = useState<Task['difficulty']>('medium')
  const [newDeadline, setNewDeadline] = useState('')
  const [newAssignmentType, setNewAssignmentType] = useState<Task['assignment_type']>('leader_assign')
  const [newAssignedTo, setNewAssignedTo] = useState('')
  // จำนวนคนของงาน และผู้ร่วมทำที่หัวหน้าเลือก (นอกจากผู้รับผิดชอบหลัก)
  const [newHeadcount, setNewHeadcount] = useState(1)
  const [newCollaborators, setNewCollaborators] = useState<string[]>([])
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])

  // โมดอลปฏิเสธงาน
  const [rejectModalTask, setRejectModalTask] = useState<Task | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectLoading, setRejectLoading] = useState(false)

  // โมดอลเปลี่ยนผู้รับผิดชอบงานที่ถูกปฏิเสธ
  const [reassignModalTask, setReassignModalTask] = useState<Task | null>(null)
  const [reassignMemberId, setReassignMemberId] = useState('')
  const [reassignLoading, setReassignLoading] = useState(false)

  // โมดอลแก้ไขงาน (หัวหน้า)
  const [editModalTask, setEditModalTask] = useState<Task | null>(null)

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
      .select('user_id, full_name, email, avatar_url, custom_avatar_url')
      .in('user_id', userIds)

    const userMap: Record<string, { full_name: string | null; email: string | null; avatar: string | null }> = {}
    for (const u of (userRows || [])) {
      userMap[u.user_id] = { full_name: u.full_name, email: u.email, avatar: u.custom_avatar_url || u.avatar_url || null }
    }

    setMembers(
      memberRows.map((m: { user_id: string; role: string; joined_at: string }) => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        full_name: userMap[m.user_id]?.full_name ?? null,
        email: userMap[m.user_id]?.email ?? null,
        avatar: userMap[m.user_id]?.avatar ?? null,
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

    const { data: collabRows } = await supabase
      .from('task_collaborators')
      .select('task_id, group_id, user_id, status, note')
      .eq('group_id', id)
    setCollaborators(collabRows || [])

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

      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (!user) {
        // เชื่อมต่อไม่ได้ ต่างจากยังไม่ล็อกอิน: แสดงข้อความแทนการเด้งไปหน้า login
        if (isAuthRetryableFetchError(userErr)) {
          setLoadFailed(true)
          setLoading(false)
          return
        }
        router.push('/login')
        return
      }
      setCurrentUserId(user.id)

      const { data: groupData, error: groupErr } = await supabase
        .from('groups')
        .select('group_id, group_name, description, work_mode, join_code, created_by, pending_leader_id, archived_at')
        .eq('group_id', id)
        .maybeSingle()

      if (groupErr) {
        setLoadFailed(true)
        setLoading(false)
        return
      }

      // กลุ่มที่ถูกลบ (archive) แล้วให้ทำเหมือนไม่พบกลุ่ม
      if (!groupData || groupData.archived_at) {
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

  // ภาระงานค้างของแต่ละคน (ใช้ในแท็บสมาชิกและฟอร์มมอบหมายงาน)
  const workloads = Object.fromEntries(members.map((m) => [m.user_id, openWorkload(m.user_id, tasks, collaborators)]))
  const memberLoads = members.filter((m) => m.role !== 'leader').map((m) => workloads[m.user_id].load)
  const avgLoad = memberLoads.length > 0 ? memberLoads.reduce((a, b) => a + b, 0) / memberLoads.length : 0
  const isOverloaded = (userId: string) => avgLoad > 0 && workloads[userId]?.load > avgLoad * 1.5
  const workloadLabel = (userId: string) => {
    const w = workloads[userId]
    return w ? `งานค้าง ${w.items.length} · ภาระ ${Math.round(w.load * 10) / 10}${isOverloaded(userId) ? ' · งานเยอะ' : ''}` : ''
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

  // ===== นำสมาชิกออก (เฉพาะหัวหน้า) =====
  // RPC คืนงานที่ยังไม่เสร็จของคนนี้เป็นงานว่าง และลบการร่วมทำงานที่ยังไม่เสร็จ ในธุรกรรมเดียว
  const handleRemoveMember = async (member: Member) => {
    setRemoveLoading(true)
    setAddMessage(null)

    const { data: unassigned, error: rpcErr } = await supabase.rpc('remove_group_member', {
      p_group_id: id,
      p_user_id: member.user_id,
    })

    if (rpcErr) {
      setAddMessage({ type: 'error', text: `นำสมาชิกออกไม่สำเร็จ: ${rpcErr.message}` })
      setRemoveLoading(false)
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'member_removed',
      entityType: 'member',
      entityId: member.user_id,
      payload: { email: member.email },
    })

    setAddMessage({
      type: 'success',
      text: `นำ ${member.full_name || member.email} ออกจากกลุ่มแล้ว${
        unassigned ? ` งานที่ยังไม่เสร็จ ${unassigned} งานกลับเป็นงานว่าง` : ''
      }`,
    })
    setRemoveConfirmId(null)
    await loadMembers()
    await loadTasks()
    setRemoveLoading(false)
  }

  // ===== ออกจากกลุ่มเอง (เฉพาะสมาชิก หัวหน้าต้องโอนหัวหน้าก่อน) =====
  // บันทึก log ก่อน เพราะหลังออกแล้วจะไม่เป็นสมาชิกและบันทึก log ไม่ได้
  const handleLeaveGroup = async () => {
    setLeaveLoading(true)
    setLeaveError(null)

    await logActivity(supabase, {
      groupId: id,
      action: 'member_left',
      entityType: 'member',
      entityId: currentUserId ?? undefined,
      payload: {},
    })

    const { error: rpcErr } = await supabase.rpc('leave_group', { p_group_id: id })

    if (rpcErr) {
      setLeaveError(`ออกจากกลุ่มไม่สำเร็จ: ${rpcErr.message}`)
      setLeaveLoading(false)
      return
    }

    router.push('/dashboard')
  }

  // ===== ลบกลุ่ม (เฉพาะหัวหน้า) =====
  // เก็บเข้าคลังด้วย archived_at ข้อมูลและประวัติกิจกรรมยังอยู่ครบ แต่กลุ่มจะถูกซ่อนทุกที่
  const handleDeleteGroup = async () => {
    if (!group) return
    setDeleteGroupLoading(true)
    setDeleteGroupError(null)

    const { error: rpcErr } = await supabase.rpc('archive_group', { p_group_id: id })

    if (rpcErr) {
      setDeleteGroupError(`ลบกลุ่มไม่สำเร็จ: ${rpcErr.message}`)
      setDeleteGroupLoading(false)
      return
    }

    await logActivity(supabase, {
      groupId: id,
      action: 'group_deleted',
      entityType: 'group',
      entityId: id,
      payload: { group_name: group.group_name },
    })

    router.push('/dashboard')
  }

  // ===== โอนตำแหน่งหัวหน้า =====
  // หัวหน้าเสนอ (หรือยกเลิกด้วย null) แล้วรอให้คนที่ถูกเสนอตอบรับเอง ไม่บังคับ
  const handleRequestTransfer = async (member: Member | null) => {
    setTransferLoading(true)
    setAddMessage(null)

    const { error: rpcErr } = await supabase.rpc('request_leader_transfer', {
      p_group_id: id,
      p_user_id: member?.user_id ?? null,
    })

    if (rpcErr) {
      setAddMessage({ type: 'error', text: `ส่งคำขอโอนหัวหน้าไม่สำเร็จ: ${rpcErr.message}` })
      setTransferLoading(false)
      return
    }

    setGroup((g) => (g ? { ...g, pending_leader_id: member?.user_id ?? null } : g))
    setAddMessage({
      type: 'success',
      text: member
        ? `ส่งคำขอให้ ${member.full_name || member.email} เป็นหัวหน้าแล้ว รอการตอบรับ`
        : 'ยกเลิกคำขอโอนหัวหน้าแล้ว',
    })
    setTransferConfirmId(null)
    setTransferLoading(false)
  }

  // คนที่ถูกเสนอตอบรับหรือปฏิเสธ ถ้าตอบรับ บทบาทจะสลับกับหัวหน้าเดิมทันที
  const handleRespondTransfer = async (accept: boolean) => {
    setTransferLoading(true)
    setTransferMessage(null)

    const { error: rpcErr } = await supabase.rpc('respond_leader_transfer', {
      p_group_id: id,
      p_accept: accept,
    })

    if (rpcErr) {
      setTransferMessage({ type: 'error', text: `ตอบคำขอไม่สำเร็จ: ${rpcErr.message}` })
      setTransferLoading(false)
      return
    }

    if (accept) {
      const me = members.find((m) => m.user_id === currentUserId)
      await logActivity(supabase, {
        groupId: id,
        action: 'leader_transferred',
        entityType: 'member',
        entityId: currentUserId ?? undefined,
        payload: { to: me?.email ?? null },
      })
    }

    setGroup((g) => (g ? { ...g, pending_leader_id: null, created_by: accept && currentUserId ? currentUserId : g.created_by } : g))
    setTransferMessage({ type: 'success', text: accept ? 'คุณเป็นหัวหน้ากลุ่มแล้ว' : 'ปฏิเสธคำขอแล้ว' })
    await loadMembers()
    setTransferLoading(false)
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

    const inviteIds =
      newAssignmentType === 'leader_assign' ? newCollaborators.filter((uid) => uid !== newAssignedTo) : []
    if (inviteIds.length > newHeadcount - 1) {
      setTaskActionMessage({ type: 'error', text: `เลือกผู้ร่วมทำได้ไม่เกิน ${newHeadcount - 1} คน` })
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
      difficulty: newDifficulty,
      headcount: newHeadcount,
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

    // เชิญผู้ร่วมทำ (ต้องกดรับเองเหมือนผู้รับผิดชอบหลัก)
    let inviteError = ''
    if (inviteIds.length > 0) {
      const { error: collabErr } = await supabase.from('task_collaborators').insert(
        inviteIds.map((uid) => ({ task_id: createdTask.task_id, group_id: id, user_id: uid, status: 'pending' }))
      )
      if (collabErr) {
        inviteError = ` แต่เชิญผู้ร่วมทำไม่สำเร็จ: ${collabErr.message}`
      } else {
        for (const uid of inviteIds) {
          await logActivity(supabase, {
            groupId: id,
            action: 'task_assigned',
            entityType: 'task',
            entityId: createdTask.task_id,
            payload: { title: createdTask.title, assigned_to: uid, assignment_type: 'leader_assign', role: 'collaborator' },
          })
        }
      }
    }

    setTaskActionMessage({
      type: inviteError ? 'error' : 'success',
      text: `สร้างงาน "${createdTask.title}" สำเร็จ${inviteError}`,
    })
    setNewTitle('')
    setNewDescription('')
    setNewPriority('medium')
    setNewDifficulty('medium')
    setNewDeadline('')
    setNewAssignmentType('leader_assign')
    setNewAssignedTo('')
    setNewHeadcount(1)
    setNewCollaborators([])
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

    // ผู้ร่วมทำที่เลื่อนตัวเองเป็นผู้รับผิดชอบหลัก: เอาออกจากรายชื่อผู้ร่วมทำ
    if (collaborators.some((c) => c.task_id === task.task_id && c.user_id === currentUserId)) {
      await supabase.from('task_collaborators').delete().eq('task_id', task.task_id).eq('user_id', currentUserId)
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

    // ถ้าคนใหม่เคยเป็นผู้ร่วมทำของงานนี้ ให้เอาออกจากรายชื่อผู้ร่วมทำ
    if (collaborators.some((c) => c.task_id === reassignModalTask.task_id && c.user_id === reassignMemberId)) {
      await supabase
        .from('task_collaborators')
        .delete()
        .eq('task_id', reassignModalTask.task_id)
        .eq('user_id', reassignMemberId)
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

  if (loadFailed) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-600 mb-4">เชื่อมต่อระบบไม่สำเร็จ โหลดข้อมูลกลุ่มไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-xl font-medium hover:shadow-lg transition-all"
        >
          ลองใหม่
        </button>
      </div>
    )
  }

  if (notFound || !group) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-600 mb-4">ไม่พบกลุ่มนี้ หรือคุณไม่ใช่สมาชิกของกลุ่ม</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-xl font-medium hover:shadow-lg transition-all"
        >
          กลับไปแดชบอร์ด
        </button>
      </div>
    )
  }

  const selectedTask = tasks.find((t) => t.task_id === selectedTaskId) ?? null
  const boardTasks = tasks.filter((t) =>
    boardFilter === 'all'
      ? true
      : boardFilter === 'mine'
      ? !!currentUserId && taskTeam(t, collaborators).includes(currentUserId)
      : t.status === 'pending' || t.status === 'rejected'
  )
  // งานที่รอฉันตอบ: ถูกมอบหมายเป็นคนหลัก หรือถูกเชิญเป็นผู้ร่วมทำ
  const awaitsMe = (t: Task) =>
    t.status !== 'completed' &&
    ((t.assignment_type === 'leader_assign' && t.status === 'assigned' && t.assigned_to === currentUserId) ||
      collaborators.some((c) => c.task_id === t.task_id && c.user_id === currentUserId && c.status === 'pending'))

  // ข้อความผลการดำเนินการ แสดงในหน้าต่างงานถ้าเปิดอยู่ ไม่งั้นแสดงบนแท็บงาน
  const taskMessageBox = taskActionMessage && (
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
  )

  // การ์ดงานบนบอร์ด
  const renderBoardCard = (t: Task) => {
    const invite = awaitsMe(t)
    const tone = t.status === 'rejected' ? 'neutral' : toneOf(t, invite)
    const team = taskTeam(t, collaborators)
    const owner = t.assigned_to === currentUserId ? 'คุณ' : getUserDisplayName(t.assigned_to)
    return (
      <button
        key={t.task_id}
        onClick={() => {
          setTaskActionMessage(null)
          setSelectedTaskId(t.task_id)
        }}
        className={`block w-full rounded-xl border bg-white p-3 text-left shadow-sm hover:border-violet-300 cursor-pointer ${
          tone === 'overdue' ? 'border-rose-300' : 'border-slate-200'
        }`}
      >
        <p className="text-[14px] font-semibold leading-snug text-slate-900">{t.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
            {t.assignment_type === 'open_choice' ? 'เปิดให้เลือก' : 'มอบหมาย'}
          </span>
          <span className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-800">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{owner}</span>
            {team.length > 1 && <span className="shrink-0">+{team.length - 1}</span>}
          </span>
          {invite && (
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONE.waiting.badge}`}>รอคุณตอบ</span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className={`text-[12px] ${tone === 'overdue' ? 'font-semibold text-rose-700' : 'text-slate-600'}`}>
            {t.deadline ? `ส่ง ${formatShortDate(t.deadline)}` : 'ไม่มีกำหนดส่ง'}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone].badge}`}>
            {tone === 'overdue' ? TONE.overdue.label : (STATUS_CONFIG[t.status] || STATUS_CONFIG.pending).label}
          </span>
        </div>
      </button>
    )
  }

  // รายละเอียดงานหนึ่งงาน แสดงในหน้าต่างเมื่อกดการ์ดบนบอร์ด
  const renderTaskDetail = (t: Task) => {
    const priorityInfo = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium
    const statusInfo = STATUS_CONFIG[t.status] || STATUS_CONFIG.pending
    const isAssignee = t.assigned_to === currentUserId
    const taskCollaborators = collaborators.filter((c) => c.task_id === t.task_id)
    // ผู้ร่วมทำที่รับงานแล้วทำได้เหมือนคนหลัก ยกเว้นกด "เสร็จแล้ว"
    const isCollaborator = taskCollaborators.some(
      (c) => c.user_id === currentUserId && c.status === 'accepted'
    )
    const isAwaitingResponse = t.assignment_type === 'leader_assign' && isAssignee && t.status === 'assigned'
    const latestRejection = t.status === 'rejected' ? getLatestRejection(t.task_id) : null
    const isOverdue = t.status !== 'completed' && !!t.deadline && new Date(t.deadline) < new Date()

    return (
      <div
        key={t.task_id}
        className={`bg-white rounded-2xl border p-5 space-y-3 ${isOverdue ? 'border-rose-300' : 'border-slate-200'}`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-800">{t.title}</h3>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${priorityInfo.className}`}>
                ความสำคัญ: {priorityInfo.label}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700">
                ความยาก: {DIFFICULTY_LABEL[t.difficulty] ?? 'กลาง'}
              </span>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${statusInfo.className}`}>
                {statusInfo.label}
              </span>
            </div>
            {t.description && (
              <p className="text-xs text-gray-600 leading-relaxed mt-1">{t.description}</p>
            )}
          </div>

          <div className="sm:text-right text-xs space-y-1 min-w-fit">
            <p className="text-gray-500">
              กำหนดส่ง:{' '}
              <span className={`font-semibold ${isOverdue ? 'text-rose-600' : 'text-gray-700'}`}>
                {formatThaiDateTime(t.deadline)}
              </span>
              {isOverdue && (
                <span className="ml-1.5 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  เลยกำหนด
                </span>
              )}
            </p>
            <p className="text-gray-500">
              ผู้รับผิดชอบ:{' '}
              <span className="font-semibold text-indigo-700">
                {getUserDisplayName(t.assigned_to)}
                {isAssignee && <span className="text-gray-400 ml-1">(คุณ)</span>}
              </span>
            </p>
            {/* งานที่เสร็จแล้วแก้ไม่ได้ เพื่อไม่ให้คะแนนย้ายจากคนที่ทำเสร็จ */}
            {isLeader && t.status !== 'completed' && (
              <button
                onClick={() => {
                  setTaskActionMessage(null)
                  setEditModalTask(t)
                }}
                className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-50 transition whitespace-nowrap cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" /> แก้ไขงาน
              </button>
            )}
          </div>
        </div>

        <TaskTeamPanel
          task={t}
          collaborators={taskCollaborators}
          currentUserId={currentUserId}
          isLeader={isLeader}
          members={members}
          onChanged={loadTasks}
        />

        <TaskWorkPanel
          task={t}
          currentUserId={currentUserId}
          canEdit={isLeader || isAssignee || isCollaborator}
        />

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
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold hover:shadow-md transition cursor-pointer"
            >
              {t.headcount > 1 ? 'รับเป็นผู้รับผิดชอบหลัก' : 'เลือกรับงานนี้'}
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
        {(isAssignee || isCollaborator) && (t.status === 'accepted' || t.status === 'in_progress') && (
          <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
            {t.status === 'accepted' && (
              <button
                onClick={() => handleStartTask(t)}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition cursor-pointer"
              >
                เริ่มทำงาน
              </button>
            )}
            {isAssignee ? (
              <button
                onClick={() => handleCompleteTask(t)}
                className="inline-flex items-center gap-1 px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer"
              >
                <CircleCheck className="h-3.5 w-3.5" /> ทำเสร็จแล้ว
              </button>
            ) : (
              <span className="text-xs text-gray-400">ผู้รับผิดชอบหลักเป็นผู้กดเสร็จแล้ว</span>
            )}
          </div>
        )}
      </div>
    )
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'ภาพรวม' },
    { id: 'tasks', label: `งาน (${tasks.length})` },
    { id: 'members', label: `สมาชิก (${members.length})` },
    { id: 'summary', label: 'สรุปผล' },
    { id: 'evaluation', label: 'ประเมินเพื่อน' },
  ]

  return (
    <div className="space-y-6">
      {/* ===== Header ===== */}
      <button
        onClick={() => router.push('/dashboard/groups')}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> กลับ
      </button>

      {/* ===== ข้อมูลกลุ่ม ===== */}
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold text-slate-900">{group.group_name}</h1>
              {isLeader ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[12px] font-semibold text-violet-800">
                  <Crown className="h-3 w-3" /> หัวหน้า
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-700">สมาชิก</span>
              )}
            </div>
            <p className="mt-1 text-[14px] text-slate-700">{group.description || 'ไม่มีรายละเอียด'}</p>
          </div>

          {/* รหัสเข้าร่วม */}
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5 min-w-fit">
            <div>
              <p className="text-[12px] text-slate-600">รหัสเข้าร่วม</p>
              <p className="font-mono text-[17px] font-bold tracking-widest text-slate-900">{group.join_code}</p>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> คัดลอกแล้ว
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> คัดลอก
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <IntegrityAlert groupId={id} />

      {/* ===== คำขอให้เป็นหัวหน้า (เห็นเฉพาะคนที่ถูกเสนอ) ===== */}
      {group.pending_leader_id === currentUserId && !isLeader && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <p className="flex items-start gap-2 text-sm text-amber-800">
            <Crown className="mt-0.5 h-4 w-4 shrink-0" />
            หัวหน้ากลุ่มเสนอให้คุณเป็นหัวหน้ากลุ่มแทน ถ้าตอบรับ หัวหน้าเดิมจะเป็นสมาชิก
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRespondTransfer(true)}
              disabled={transferLoading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              ตอบรับ
            </button>
            <button
              onClick={() => handleRespondTransfer(false)}
              disabled={transferLoading}
              className="px-4 py-2 border border-gray-200 bg-white text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              ปฏิเสธ
            </button>
          </div>
        </div>
      )}
      {transferMessage && (
        <div
          className={`px-4 py-2.5 rounded-xl text-sm ${
            transferMessage.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-100'
              : 'bg-red-50 text-red-700 border border-red-100'
          }`}
        >
          {transferMessage.text}
        </div>
      )}

      {/* ===== แถบแท็บ ===== */}
      <div className="flex gap-5 sm:gap-8 overflow-x-auto border-b border-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-[14px] transition-colors ${
              activeTab === item.id
                ? 'border-violet-600 font-semibold text-violet-700'
                : 'border-transparent font-medium text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* ===== แท็บ: ภาพรวม ===== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-[15px] font-bold text-slate-900">ข้อมูลภาพรวมกลุ่ม</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[12px] text-slate-600">รูปแบบการทำงาน</p>
                <p className="mt-0.5 text-[14px] font-semibold text-slate-900">
                  {group.work_mode === 'leader_all'
                    ? 'หัวหน้าคุม'
                    : group.work_mode === 'member_choose'
                    ? 'สมาชิกเลือก'
                    : group.work_mode === 'mixed'
                    ? 'แบบผสม'
                    : group.work_mode}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[12px] text-slate-600">บทบาทของฉันในกลุ่ม</p>
                <p className="mt-0.5 text-[14px] font-semibold text-slate-900">
                  {isLeader ? 'หัวหน้า' : 'สมาชิก'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3.5">
                <p className="text-[12px] text-slate-600">จำนวนสมาชิก</p>
                <p className="mt-0.5 text-[14px] font-semibold text-slate-900">{members.length} คน</p>
              </div>
            </div>

            {/* หลอดความคืบหน้าของโครงการ */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-800">ความคืบหน้าของโครงการ</span>
                <span className="font-bold text-violet-700">{projectProgress(tasks)}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-violet-600 transition-all"
                  style={{ width: `${projectProgress(tasks)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[12px] text-slate-600">
                เสร็จแล้ว {tasks.filter((t) => t.status === 'completed').length} จาก {tasks.length} งาน
              </p>
            </div>
          </div>

          {currentUserId && (
            <CatchUpDigest
              groupId={id}
              currentUserId={currentUserId}
              members={members}
              onOpenTasks={() => setActiveTab('tasks')}
            />
          )}

          {/* ===== ตั้งค่ากลุ่ม: ลบกลุ่ม (เฉพาะหัวหน้า) ต้องพิมพ์ชื่อกลุ่มให้ตรงก่อน ===== */}
          {isLeader && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-[15px] font-bold text-slate-900">ตั้งค่ากลุ่ม</h2>
              <div className="mt-3 rounded-xl border border-rose-200 p-4">
                <p className="text-[14px] font-semibold text-rose-800">ลบกลุ่ม</p>
                <p className="mt-1 text-[13px] text-slate-700">
                  กลุ่มจะถูกเก็บเข้าคลัง สมาชิกทุกคนจะไม่เห็นกลุ่มนี้อีก งานและประวัติยังเก็บไว้
                </p>
                <label className="mt-3 block text-[13px] text-slate-700">
                  พิมพ์ <span className="font-semibold text-slate-900">{group.group_name}</span> เพื่อยืนยัน
                  <input
                    value={deleteGroupText}
                    onChange={(e) => setDeleteGroupText(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-violet-500"
                  />
                </label>
                {deleteGroupError && <p className="mt-2 text-[13px] text-rose-700">{deleteGroupError}</p>}
                <button
                  onClick={handleDeleteGroup}
                  disabled={deleteGroupLoading || deleteGroupText.trim() !== group.group_name.trim()}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-200"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {deleteGroupLoading ? 'กำลังลบ...' : 'ลบกลุ่มนี้'}
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ===== แท็บ: งาน ===== */}
      {activeTab === 'tasks' && (
        <div className="space-y-6">
          {/* ข้อความแจ้งเตือนผลการดำเนินการ (ถ้าเปิดหน้าต่างงานอยู่จะแสดงในหน้าต่างแทน) */}
          {!selectedTask && taskMessageBox}

          {/* ตัวกรองบอร์ด และปุ่มสร้างงาน (เฉพาะหัวหน้า) */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', 'ทั้งหมด'],
                ['mine', 'ของฉัน'],
                ['open', 'ยังไม่มีคนทำ'],
              ] as const).map(([fid, label]) => (
                <button
                  key={fid}
                  onClick={() => setBoardFilter(fid)}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium cursor-pointer ${
                    boardFilter === fid ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {isLeader && (
              <button
                onClick={() => {
                  setTaskActionMessage(null)
                  setShowCreateModal(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-violet-700 whitespace-nowrap cursor-pointer"
              >
                <Plus className="h-4 w-4" /> สร้างงาน
              </button>
            )}
          </div>

          {/* หน้าต่างฟอร์มสร้างงานใหม่ (เฉพาะหัวหน้า) */}
          {showCreateModal && isLeader && (
            <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10">
            <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-base font-bold text-gray-800">สร้างงานใหม่</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 text-sm"
                >
                  <X className="h-4 w-4" /> ปิด
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
                    <label className="block text-xs font-semibold text-gray-700 mb-1">ความยาก</label>
                    <select
                      value={newDifficulty}
                      onChange={(e) => setNewDifficulty(e.target.value as Task['difficulty'])}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                    >
                      <option value="easy">ง่าย</option>
                      <option value="medium">กลาง</option>
                      <option value="hard">ยาก</option>
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
                  <label className="block text-xs font-semibold text-gray-700 mb-1">จำนวนคนที่ทำงานนี้</label>
                  <select
                    value={newHeadcount}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setNewHeadcount(n)
                      setNewCollaborators((prev) => prev.slice(0, n - 1))
                    }}
                    className="w-full sm:w-48 px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 คน (ทำคนเดียว)' : `${n} คน (หลัก 1 + ผู้ร่วมทำ ${n - 1})`}
                      </option>
                    ))}
                  </select>
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
                          {m.full_name || m.email} ({m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}) — {workloadLabel(m.user_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {newAssignmentType === 'leader_assign' && newHeadcount > 1 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ผู้ร่วมทำ (เลือกได้ไม่เกิน {newHeadcount - 1} คน · ต้องกดรับงานเอง)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {members
                        .filter((m) => m.user_id !== newAssignedTo)
                        .map((m) => {
                          const checked = newCollaborators.includes(m.user_id)
                          const full = !checked && newCollaborators.length >= newHeadcount - 1
                          return (
                            <label
                              key={m.user_id}
                              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                                full ? 'opacity-50' : 'cursor-pointer'
                              } ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={full}
                                onChange={() =>
                                  setNewCollaborators((prev) =>
                                    checked ? prev.filter((uid) => uid !== m.user_id) : [...prev, m.user_id]
                                  )
                                }
                              />
                              {m.full_name || m.email}
                              <span className="text-gray-400">({workloadLabel(m.user_id)})</span>
                            </label>
                          )
                        })}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">ไม่เลือกครบก็ได้ เชิญเพิ่มภายหลังได้จากการ์ดงาน</p>
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
                    className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold hover:shadow-md transition disabled:opacity-50"
                  >
                    {createTaskLoading ? 'กำลังสร้าง...' : 'บันทึกสร้างงาน'}
                  </button>
                </div>
              </form>
            </div>
            </div>
          )}

          {/* บอร์ดงาน 3 คอลัมน์ กดการ์ดเพื่อเปิดรายละเอียดในหน้าต่าง */}
          {tasksLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-600">
              กำลังโหลดรายการงาน...
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-[13px] text-slate-600">
              ยังไม่มีงานในกลุ่มนี้
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {BOARD_COLUMNS.map((col) => {
                const items = boardTasks.filter((t) => col.statuses.includes(t.status))
                return (
                  <section key={col.key} className="rounded-2xl border border-slate-200 bg-slate-100/70 p-2.5">
                    <h3 className="mb-2.5 flex items-center gap-2 px-1">
                      <span className={`rounded-md px-2 py-0.5 text-[13px] font-bold ${col.pill}`}>{col.title}</span>
                      <span className="text-[13px] font-semibold text-slate-600">{items.length}</span>
                    </h3>
                    <div className="space-y-2">
                      {items.map(renderBoardCard)}
                      {items.length === 0 && <p className="px-1 py-3 text-[12px] text-slate-600">ไม่มีงาน</p>}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {/* หน้าต่างรายละเอียดงาน: ปุ่มรับ/ปฏิเสธ/เริ่ม/เสร็จ ทีมงาน ลิงก์ผลงาน และความเห็นอยู่ในนี้ทั้งหมด */}
          {selectedTask && (
            <div
              className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10"
              onClick={() => setSelectedTaskId(null)}
            >
              <div className="relative w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setSelectedTaskId(null)}
                  aria-label="ปิด"
                  className="absolute -top-9 right-0 rounded-full bg-white p-1.5 text-slate-700 shadow"
                >
                  <X className="h-4 w-4" />
                </button>
                {taskMessageBox}
                {renderTaskDetail(selectedTask)}
              </div>
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

          {/* กล่องโมดอลแก้ไขงาน (หัวหน้า) */}
          {editModalTask && isLeader && (
            <TaskEditModal
              task={editModalTask}
              collaborators={collaborators.filter((c) => c.task_id === editModalTask.task_id)}
              members={members}
              workloadLabel={workloadLabel}
              onClose={() => setEditModalTask(null)}
              onSaved={async (message) => {
                setEditModalTask(null)
                setTaskActionMessage(message)
                await loadTasks()
              }}
            />
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
                          {m.full_name || m.email} ({m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}) — {workloadLabel(m.user_id)}
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
                    className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold hover:shadow-md transition disabled:opacity-50"
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
                  className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-medium hover:shadow-lg transition-all disabled:opacity-50 text-sm whitespace-nowrap"
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

            {leaveError && (
              <div className="mb-3 px-4 py-2.5 rounded-xl text-sm bg-red-50 text-red-700 border border-red-100">
                {leaveError}
              </div>
            )}

            {members.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มีสมาชิก</p>
            ) : (
              <ul className="space-y-3">
                {members.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-2 py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                    <UserAvatar
                      src={m.avatar}
                      name={m.full_name || m.email || '?'}
                      className="h-9 w-9 rounded-full bg-indigo-100 text-indigo-700 text-sm"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {m.full_name || m.email || 'ไม่ทราบชื่อ'}
                        {m.user_id === currentUserId && (
                          <span className="ml-2 text-xs text-gray-400">(คุณ)</span>
                        )}
                        <span
                          className={`ml-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full align-middle whitespace-nowrap ${
                            m.role === 'leader'
                              ? 'bg-indigo-100 text-indigo-700 font-semibold'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {m.role === 'leader' ? <Crown className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}
                        </span>
                      </p>
                      {m.full_name && (
                        <p className="text-xs text-gray-400">{m.email}</p>
                      )}
                      {/* งานที่ยังไม่เสร็จของคนนี้ ช่วยให้หัวหน้าจัดสรรงานไม่ให้ใครหนักเกินไป */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500">
                          งานค้าง {workloads[m.user_id]?.items.length ?? 0} งาน · ภาระ{' '}
                          {Math.round((workloads[m.user_id]?.load ?? 0) * 10) / 10}
                        </span>
                        {isOverloaded(m.user_id) && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700">
                            งานเยอะกว่าคนอื่น
                          </span>
                        )}
                        {workloads[m.user_id]?.items.map(({ task, role }) => (
                          <span
                            key={task.task_id}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
                            title={task.deadline ? `กำหนดส่ง ${formatThaiDateTime(task.deadline)}` : undefined}
                          >
                            {task.title}
                            {role === 'collaborator' && ' (ร่วมทำ)'}
                          </span>
                        ))}
                      </div>
                    </div>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {isLeader && m.role !== 'leader' && (
                      group.pending_leader_id === m.user_id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-700">รอตอบรับเป็นหัวหน้า</span>
                          <button
                            onClick={() => handleRequestTransfer(null)}
                            disabled={transferLoading}
                            className="px-3 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            ยกเลิกคำขอ
                          </button>
                        </div>
                      ) : transferConfirmId === m.user_id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-indigo-600">เสนอให้เป็นหัวหน้า?</span>
                          <button
                            onClick={() => handleRequestTransfer(m)}
                            disabled={transferLoading}
                            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {transferLoading ? 'กำลังส่ง...' : 'ยืนยัน'}
                          </button>
                          <button
                            onClick={() => setTransferConfirmId(null)}
                            disabled={transferLoading}
                            className="px-3 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setTransferConfirmId(m.user_id)}
                          className="px-3 py-1 border border-indigo-200 text-indigo-600 rounded-lg text-xs hover:bg-indigo-50 whitespace-nowrap"
                        >
                          โอนหัวหน้า
                        </button>
                      )
                    )}
                    {isLeader && m.role !== 'leader' && (
                      removeConfirmId === m.user_id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-red-600">นำออกจากกลุ่ม?</span>
                          <button
                            onClick={() => handleRemoveMember(m)}
                            disabled={removeLoading}
                            className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                          >
                            {removeLoading ? 'กำลังนำออก...' : 'ยืนยัน'}
                          </button>
                          <button
                            onClick={() => setRemoveConfirmId(null)}
                            disabled={removeLoading}
                            className="px-3 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRemoveConfirmId(m.user_id)}
                          className="px-3 py-1 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 whitespace-nowrap"
                        >
                          นำออก
                        </button>
                      )
                    )}
                    {!isLeader && m.user_id === currentUserId && (
                      leaveConfirm ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-red-600">ออกจากกลุ่ม? งานที่ยังไม่เสร็จจะกลับเป็นงานว่าง</span>
                          <button
                            onClick={handleLeaveGroup}
                            disabled={leaveLoading}
                            className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                          >
                            {leaveLoading ? 'กำลังออก...' : 'ยืนยัน'}
                          </button>
                          <button
                            onClick={() => setLeaveConfirm(false)}
                            disabled={leaveLoading}
                            className="px-3 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setLeaveConfirm(true)}
                          className="px-3 py-1 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50 whitespace-nowrap"
                        >
                          ออกจากกลุ่ม
                        </button>
                      )
                    )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== แท็บ: สรุปผล ===== */}
      {activeTab === 'summary' && (
        <ParticipationSummary
          groupId={id}
          groupName={group.group_name}
          members={members}
          tasks={tasks}
          taskResponses={taskResponses}
          showPeerEval={isLeader}
        />
      )}

      {/* ===== แท็บ: ประเมินเพื่อน ===== */}
      {activeTab === 'evaluation' && currentUserId && (
        <PeerEvaluation groupId={id} currentUserId={currentUserId} isLeader={isLeader} members={members} />
      )}
    </div>
  )
}
