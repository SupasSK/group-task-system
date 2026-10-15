'use client'
import { useState } from 'react'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'
import type { Collaborator } from '@/components/dashboard/TaskTeamPanel'

interface EditableTask {
  task_id: string
  group_id: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  difficulty: 'easy' | 'medium' | 'hard'
  headcount: number
  status: string
  assignment_type: 'leader_assign' | 'open_choice'
  assigned_to: string | null
  deadline: string | null
}

interface EditMember {
  user_id: string
  role: string
  full_name: string | null
  email: string | null
}

const field = 'w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white'

// ISO → ค่าของ input datetime-local (เวลาท้องถิ่น)
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// หัวหน้าแก้ไขงาน: ต้องใส่เหตุผลเมื่อเปลี่ยนกำหนดส่ง ผู้รับผิดชอบ/ผู้ร่วมทำ หรือความยาก
export default function TaskEditModal({
  task,
  collaborators,
  members,
  workloadLabel,
  onClose,
  onSaved,
}: {
  task: EditableTask
  // ผู้ร่วมทำของงานนี้ (ทุกสถานะ)
  collaborators: Collaborator[]
  members: EditMember[]
  workloadLabel: (userId: string) => string
  onClose: () => void
  onSaved: (message: { type: 'success' | 'error'; text: string }) => void | Promise<void>
}) {
  const supabase = createClient()
  const initialCollabs = collaborators.filter((c) => c.status !== 'rejected').map((c) => c.user_id)

  const [title, setTitle] = useState(task.title)
  const [priority, setPriority] = useState(task.priority)
  const [difficulty, setDifficulty] = useState(task.difficulty ?? 'medium')
  const [deadline, setDeadline] = useState(toLocalInput(task.deadline))
  const [headcount, setHeadcount] = useState(task.headcount ?? 1)
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? '')
  const [collabIds, setCollabIds] = useState<string[]>(initialCollabs)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  const assigneeChanged = (assignedTo || null) !== task.assigned_to
  const collabsChanged = !sameSet(collabIds, initialCollabs)
  const deadlineChanged = deadline !== toLocalInput(task.deadline)
  const difficultyChanged = difficulty !== (task.difficulty ?? 'medium')
  const needsReason = assigneeChanged || collabsChanged || deadlineChanged || difficultyChanged

  const handleSave = async () => {
    const newTitle = title.trim()
    if (!newTitle) return setError('กรุณาระบุชื่องาน')
    if (task.assignment_type === 'leader_assign' && !assignedTo) return setError('กรุณาเลือกผู้รับผิดชอบหลัก')
    if (collabIds.length > headcount - 1) return setError(`ผู้ร่วมทำมีได้ไม่เกิน ${headcount - 1} คน`)
    if (needsReason && !reason.trim()) return setError('กรุณาระบุเหตุผลของการเปลี่ยนแปลง')

    const newDeadline = deadline ? new Date(deadline).toISOString() : null
    const newAssignee = assignedTo || null
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (newTitle !== task.title) changes.title = { from: task.title, to: newTitle }
    if (priority !== task.priority) changes.priority = { from: task.priority, to: priority }
    if (difficultyChanged) changes.difficulty = { from: task.difficulty, to: difficulty }
    if (deadlineChanged) changes.deadline = { from: task.deadline, to: newDeadline }
    if (headcount !== task.headcount) changes.headcount = { from: task.headcount, to: headcount }
    if (assigneeChanged) changes.assigned_to = { from: task.assigned_to, to: newAssignee }
    if (collabsChanged) changes.collaborators = { from: initialCollabs, to: collabIds }

    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }

    setSaving(true)
    setError(null)

    const update: Record<string, unknown> = {
      title: newTitle,
      priority,
      difficulty,
      deadline: newDeadline,
      headcount,
      assigned_to: newAssignee,
      updated_at: new Date().toISOString(),
    }
    // เปลี่ยนคนหลักของงานที่ยังไม่เสร็จ: คนใหม่ต้องกดรับงานเอง / ล้างคนหลักของงานเลือกเอง: กลับเป็นงานว่าง
    if (assigneeChanged && task.status !== 'completed') {
      const nextStatus = newAssignee ? 'assigned' : 'pending'
      update.status = nextStatus
      if (newAssignee) update.assignment_type = 'leader_assign'
      if (nextStatus !== task.status) changes.status = { from: task.status, to: nextStatus }
    }

    const { error: updateErr } = await supabase.from('tasks').update(update).eq('task_id', task.task_id)
    if (updateErr) {
      setError(`บันทึกไม่สำเร็จ: ${updateErr.message}`)
      setSaving(false)
      return
    }

    // ลบผู้ร่วมทำที่ถูกเอาออก (รวมแถวที่เคยปฏิเสธของคนที่ถูกเชิญใหม่ และคนที่เลื่อนเป็นคนหลัก) แล้วค่อยเชิญคนใหม่
    let teamError = ''
    const added = collabIds.filter((uid) => !initialCollabs.includes(uid))
    const toDelete = collaborators
      .filter(
        (c) =>
          (c.status !== 'rejected' && !collabIds.includes(c.user_id)) ||
          (c.status === 'rejected' && (added.includes(c.user_id) || c.user_id === newAssignee))
      )
      .map((c) => c.user_id)
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('task_collaborators')
        .delete()
        .eq('task_id', task.task_id)
        .in('user_id', toDelete)
      if (delErr) teamError = ` แต่เอาผู้ร่วมทำออกไม่สำเร็จ: ${delErr.message}`
    }
    if (!teamError && added.length > 0) {
      const { error: insErr } = await supabase
        .from('task_collaborators')
        .insert(added.map((uid) => ({ task_id: task.task_id, group_id: task.group_id, user_id: uid, status: 'pending' })))
      if (insErr) teamError = ` แต่เชิญผู้ร่วมทำไม่สำเร็จ: ${insErr.message}`
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_updated',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: newTitle, changes, ...(needsReason ? { reason: reason.trim() } : {}) },
    })

    setSaving(false)
    await onSaved({
      type: teamError ? 'error' : 'success',
      text: `บันทึกการแก้ไขงาน "${newTitle}" แล้ว${teamError}`,
    })
  }

  // ลบงานจริง ผู้ร่วมทำ ฟีดแบค คำตอบรับ และบันทึกความคืบหน้าถูกลบตาม ส่วนประวัติกิจกรรมยังอยู่
  const handleDelete = async () => {
    setSaving(true)
    setError(null)
    const { data, error: delErr } = await supabase.from('tasks').delete().eq('task_id', task.task_id).select('task_id')
    if (delErr || !data || data.length === 0) {
      setError(`ลบงานไม่สำเร็จ: ${delErr?.message ?? 'ไม่มีสิทธิ์ลบงานนี้'}`)
      setSaving(false)
      return
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_deleted',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title },
    })

    setSaving(false)
    await onSaved({ type: 'success', text: `ลบงาน "${task.title}" แล้ว` })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-gray-800">แก้ไขงาน: {task.title}</h3>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            ชื่องาน <span className="text-red-500">*</span>
          </label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">ความสำคัญ</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as EditableTask['priority'])} className={field}>
              <option value="low">ต่ำ (low)</option>
              <option value="medium">กลาง (medium)</option>
              <option value="high">สูง (high)</option>
              <option value="urgent">ด่วน (urgent)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">ความยาก</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as EditableTask['difficulty'])}
              className={field}
            >
              <option value="easy">ง่าย</option>
              <option value="medium">กลาง</option>
              <option value="hard">ยาก</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">กำหนดส่ง (Deadline)</label>
            <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={field} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">จำนวนคนที่ทำงานนี้</label>
            <select
              value={headcount}
              onChange={(e) => {
                const n = Number(e.target.value)
                setHeadcount(n)
                setCollabIds((prev) => prev.slice(0, n - 1))
              }}
              className={field}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 คน (ทำคนเดียว)' : `${n} คน (หลัก 1 + ผู้ร่วมทำ ${n - 1})`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">ผู้รับผิดชอบหลัก</label>
          <select
            value={assignedTo}
            onChange={(e) => {
              setAssignedTo(e.target.value)
              setCollabIds((prev) => prev.filter((uid) => uid !== e.target.value))
            }}
            className={field}
          >
            {task.assignment_type === 'open_choice' ? (
              <option value="">ยังไม่มี (เปิดให้สมาชิกเลือกเอง)</option>
            ) : (
              !assignedTo && <option value="">-- กรุณาเลือกสมาชิก --</option>
            )}
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || m.email} ({m.role === 'leader' ? 'หัวหน้า' : 'สมาชิก'}) — {workloadLabel(m.user_id)}
              </option>
            ))}
          </select>
          {assigneeChanged && task.status !== 'completed' && assignedTo && (
            <p className="mt-1 text-[11px] text-amber-700">ผู้รับผิดชอบคนใหม่ต้องกดรับงานอีกครั้ง</p>
          )}
        </div>

        {headcount > 1 && (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              ผู้ร่วมทำ (ไม่เกิน {headcount - 1} คน · คนที่เพิ่มใหม่ต้องกดรับงานเอง)
            </label>
            <div className="flex flex-wrap gap-2">
              {members
                .filter((m) => m.user_id !== assignedTo)
                .map((m) => {
                  const checked = collabIds.includes(m.user_id)
                  const full = !checked && collabIds.length >= headcount - 1
                  const current = collaborators.find((c) => c.user_id === m.user_id && c.status !== 'rejected')
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
                          setCollabIds((prev) => (checked ? prev.filter((uid) => uid !== m.user_id) : [...prev, m.user_id]))
                        }
                      />
                      {m.full_name || m.email}
                      {current && (
                        <span className="text-gray-400">({current.status === 'accepted' ? 'ร่วมทำอยู่' : 'รอตอบรับ'})</span>
                      )}
                    </label>
                  )
                })}
            </div>
          </div>
        )}

        {needsReason && (
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              เหตุผลของการเปลี่ยนแปลง <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น อาจารย์เลื่อนกำหนดส่ง, สมาชิกป่วย, งานยากกว่าที่ประเมินไว้"
              className={field}
            />
            <p className="mt-1 text-[11px] text-gray-400">สมาชิกทุกคนจะเห็นเหตุผลนี้ในประวัติกิจกรรม</p>
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        {confirmDelete ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2">
            <p className="text-xs text-rose-700">
              ยืนยันลบงาน &quot;{task.title}&quot;? ผู้ร่วมทำ ฟีดแบค และบันทึกความคืบหน้าของงานนี้จะถูกลบด้วย
              และกู้คืนไม่ได้ (ประวัติกิจกรรมยังอยู่)
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={saving}
                className="px-4 py-2 border border-gray-200 bg-white text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition"
              >
                ไม่ลบ
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition disabled:opacity-50"
              >
                {saving ? 'กำลังลบ...' : 'ยืนยันลบงาน'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              className="px-4 py-2 border border-rose-200 text-rose-600 rounded-xl text-xs hover:bg-rose-50 transition disabled:opacity-50"
            >
              ลบงาน
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-xs font-semibold hover:shadow-md transition disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
