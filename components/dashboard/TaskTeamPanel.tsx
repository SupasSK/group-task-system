'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'

export interface Collaborator {
  task_id: string
  group_id: string
  user_id: string
  status: 'pending' | 'accepted' | 'rejected'
  note: string | null
}

interface TeamTask {
  task_id: string
  group_id: string
  title: string
  status: string
  assignment_type: 'leader_assign' | 'open_choice'
  assigned_to: string | null
  headcount?: number
}

interface TeamMember {
  user_id: string
  role: string
  full_name: string | null
  email: string | null
}

const COLLAB_STATUS: Record<Collaborator['status'], { label: string; className: string }> = {
  pending: { label: 'รอตอบรับ', className: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'ร่วมทำ', className: 'bg-indigo-100 text-indigo-700' },
  rejected: { label: 'ปฏิเสธ', className: 'bg-rose-100 text-rose-700' },
}

const btn = 'px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-60'

// ทีมของงานที่ทำหลายคน: รายชื่อ, ตอบรับคำเชิญ, เข้าร่วมงานว่าง, หัวหน้าเชิญเพิ่ม, ฟีดแบคหลังงานเสร็จ
// งานที่มีคนเดียว (headcount = 1) ไม่แสดงส่วนนี้
export default function TaskTeamPanel({
  task,
  collaborators,
  currentUserId,
  isLeader = false,
  members,
  onChanged,
}: {
  task: TeamTask
  collaborators: Collaborator[]
  currentUserId: string | null
  isLeader?: boolean
  // รายชื่อสมาชิกกลุ่ม (ถ้าไม่ส่งมา จะดึงชื่อเฉพาะคนในทีม และเชิญเพิ่มไม่ได้)
  members?: TeamMember[]
  onChanged: () => void | Promise<void>
}) {
  const supabase = createClient()
  const headcount = task.headcount ?? 1
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)
  const [inviteId, setInviteId] = useState('')
  // ฟีดแบคที่ผู้ใช้ส่งไปแล้วในงานนี้ (user_id ของผู้รับ)
  const [sentTo, setSentTo] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, { score: number; comment: string }>>({})

  const active = collaborators.filter((c) => c.status !== 'rejected')
  const accepted = collaborators.filter((c) => c.status === 'accepted')
  const mine = collaborators.find((c) => c.user_id === currentUserId)
  const isMain = !!currentUserId && task.assigned_to === currentUserId
  const isParticipant = isMain || mine?.status === 'accepted'
  const slotsLeft = headcount - 1 - active.length
  const isOpen = task.status !== 'completed' && task.status !== 'rejected'
  // คนอื่นในทีมที่ผู้ใช้ให้ฟีดแบคได้
  const teammates = [task.assigned_to, ...accepted.map((c) => c.user_id)].filter(
    (uid): uid is string => !!uid && uid !== currentUserId
  )
  const showFeedback = task.status === 'completed' && isParticipant && teammates.length > 0
  const teamKey = [task.assigned_to, ...collaborators.map((c) => c.user_id)].join(',')

  useEffect(() => {
    if (members) return
    const ids = teamKey.split(',').filter(Boolean)
    if (ids.length === 0) return
    supabase
      .from('users')
      .select('user_id, full_name, email')
      .in('user_id', ids)
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const u of data || []) map[u.user_id] = u.full_name || u.email || 'สมาชิก'
        setNames(map)
      })
  }, [teamKey, members, supabase])

  useEffect(() => {
    if (!showFeedback || !currentUserId) return
    supabase
      .from('task_feedback')
      .select('to_user')
      .eq('task_id', task.task_id)
      .eq('from_user', currentUserId)
      .then(({ data }) => setSentTo((data || []).map((f) => f.to_user)))
  }, [showFeedback, currentUserId, task.task_id, supabase])

  if (headcount <= 1 && collaborators.length === 0) return null

  const getName = (userId: string) => {
    const m = members?.find((item) => item.user_id === userId)
    return m?.full_name || m?.email || names[userId] || 'สมาชิก'
  }

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    const err = await action()
    if (err) setError(err)
    else await onChanged()
    setBusy(false)
  }

  const handleRespond = (response: 'accepted' | 'rejected') =>
    run(async () => {
      const reason = declineReason.trim()
      if (response === 'rejected' && !reason) return 'กรุณากรอกเหตุผลในการปฏิเสธ'
      const { error: err } = await supabase
        .from('task_collaborators')
        .update({ status: response, note: reason || null, responded_at: new Date().toISOString() })
        .eq('task_id', task.task_id)
        .eq('user_id', currentUserId)
      if (err) return `ตอบรับไม่สำเร็จ: ${err.message}`
      await logActivity(supabase, {
        groupId: task.group_id,
        action: response === 'accepted' ? 'task_joined' : 'task_declined',
        entityType: 'task',
        entityId: task.task_id,
        payload: response === 'accepted' ? { title: task.title, role: 'collaborator' } : { title: task.title, reason },
      })
      setShowDecline(false)
      setDeclineReason('')
      return null
    })

  const handleJoin = () =>
    run(async () => {
      const { error: err } = await supabase.from('task_collaborators').insert({
        task_id: task.task_id,
        group_id: task.group_id,
        user_id: currentUserId,
        status: 'accepted',
      })
      if (err) return `เข้าร่วมงานไม่สำเร็จ: ${err.message}`
      await logActivity(supabase, {
        groupId: task.group_id,
        action: 'task_joined',
        entityType: 'task',
        entityId: task.task_id,
        payload: { title: task.title, role: 'collaborator' },
      })
      return null
    })

  const handleInvite = () =>
    run(async () => {
      if (!inviteId) return 'กรุณาเลือกสมาชิก'
      // คนที่เคยปฏิเสธงานนี้มีแถวเดิมอยู่ ต้องลบก่อนเชิญใหม่
      if (collaborators.some((c) => c.user_id === inviteId && c.status === 'rejected')) {
        await supabase.from('task_collaborators').delete().eq('task_id', task.task_id).eq('user_id', inviteId)
      }
      const { error: err } = await supabase.from('task_collaborators').insert({
        task_id: task.task_id,
        group_id: task.group_id,
        user_id: inviteId,
        status: 'pending',
      })
      if (err) return `เชิญผู้ร่วมทำไม่สำเร็จ: ${err.message}`
      await logActivity(supabase, {
        groupId: task.group_id,
        action: 'task_assigned',
        entityType: 'task',
        entityId: task.task_id,
        payload: { title: task.title, assigned_to: inviteId, assignment_type: task.assignment_type, role: 'collaborator' },
      })
      setInviteId('')
      return null
    })

  const handleRemoveRejected = (userId: string) =>
    run(async () => {
      const { error: err } = await supabase
        .from('task_collaborators')
        .delete()
        .eq('task_id', task.task_id)
        .eq('user_id', userId)
      return err ? `เอาออกไม่สำเร็จ: ${err.message}` : null
    })

  const handleSendFeedback = (toUser: string) =>
    run(async () => {
      const d = drafts[toUser]
      if (!d?.score) return 'กรุณาเลือกคะแนน 1-5'
      const { error: err } = await supabase.from('task_feedback').insert({
        task_id: task.task_id,
        group_id: task.group_id,
        from_user: currentUserId,
        to_user: toUser,
        score: d.score,
        comment: d.comment.trim() || null,
      })
      if (err) return `ส่งฟีดแบคไม่สำเร็จ: ${err.message}`
      // ไม่บันทึกคะแนนลง log เพราะสมาชิกทุกคนอ่าน log ได้
      await logActivity(supabase, {
        groupId: task.group_id,
        action: 'task_feedback_added',
        entityType: 'task',
        entityId: task.task_id,
        payload: { title: task.title },
      })
      setSentTo((prev) => [...prev, toUser])
      return null
    })

  const invitable = (members || []).filter(
    (m) => m.user_id !== task.assigned_to && !active.some((c) => c.user_id === m.user_id)
  )

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2.5 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-gray-700">
          ทีม ({(task.assigned_to ? 1 : 0) + active.length}/{headcount} คน)
        </span>
        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-gray-700">
          {task.assigned_to ? getName(task.assigned_to) : 'ยังไม่มี'} · หลัก
        </span>
        {collaborators.map((c) => (
          <span key={c.user_id} className={`rounded-full px-2 py-0.5 ${COLLAB_STATUS[c.status].className}`}>
            {getName(c.user_id)} · {COLLAB_STATUS[c.status].label}
            {c.status === 'rejected' && c.note && ` (${c.note})`}
            {isLeader && c.status === 'rejected' && (
              <button
                onClick={() => handleRemoveRejected(c.user_id)}
                disabled={busy}
                className="ml-1 font-bold cursor-pointer"
                aria-label="เอาออก"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {error && <p className="text-rose-600">{error}</p>}

      {/* ผู้ถูกเชิญตอบรับ */}
      {mine?.status === 'pending' && isOpen && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-600">หัวหน้าเชิญคุณเป็นผู้ร่วมทำงานนี้</span>
          <button onClick={() => handleRespond('accepted')} disabled={busy} className={`${btn} bg-emerald-600 text-white`}>
            รับงาน
          </button>
          <button
            onClick={() => setShowDecline((v) => !v)}
            disabled={busy}
            className={`${btn} bg-rose-50 text-rose-700 border border-rose-200`}
          >
            ปฏิเสธ
          </button>
          {showDecline && (
            <div className="flex w-full items-center gap-2">
              <input
                className="gt-input !py-1.5 text-xs flex-1"
                placeholder="เหตุผลในการปฏิเสธ (บังคับ)"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <button onClick={() => handleRespond('rejected')} disabled={busy} className={`${btn} bg-rose-600 text-white`}>
                ยืนยันปฏิเสธ
              </button>
            </div>
          )}
        </div>
      )}

      {/* งานแบบสมาชิกเลือกเอง: เข้าร่วมเป็นผู้ร่วมทำ */}
      {task.assignment_type === 'open_choice' && isOpen && !isMain && !mine && slotsLeft > 0 && currentUserId && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500">ว่างอีก {slotsLeft} ที่สำหรับผู้ร่วมทำ</span>
          <button onClick={handleJoin} disabled={busy} className={`${btn} bg-indigo-600 text-white`}>
            เข้าร่วมทำ
          </button>
        </div>
      )}

      {/* หัวหน้าเชิญผู้ร่วมทำเพิ่มในที่ที่ว่าง */}
      {isLeader && members && isOpen && slotsLeft > 0 && invitable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={inviteId}
            onChange={(e) => setInviteId(e.target.value)}
            className="px-2 py-1 border border-gray-200 rounded-lg bg-white text-xs"
          >
            <option value="">-- เชิญผู้ร่วมทำ (ว่าง {slotsLeft} ที่) --</option>
            {invitable.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
          <button onClick={handleInvite} disabled={busy || !inviteId} className={`${btn} bg-indigo-600 text-white`}>
            เชิญ
          </button>
        </div>
      )}

      {/* ฟีดแบคหลังงานเสร็จ (เปิดชื่อ) */}
      {showFeedback && (
        <div className="border-t border-slate-200 pt-2 space-y-2">
          <p className="font-semibold text-gray-700">ฟีดแบคเพื่อนร่วมงานในงานนี้</p>
          <p className="text-amber-700">หัวหน้าจะเห็นชื่อผู้ให้ฟีดแบค ส่งแล้วแก้ไขไม่ได้ เพื่อนที่ได้รับฟีดแบคจะไม่เห็น</p>
          {teammates.map((uid) =>
            sentTo.includes(uid) ? (
              <p key={uid} className="text-emerald-700">ส่งฟีดแบคให้ {getName(uid)} แล้ว</p>
            ) : (
              <div key={uid} className="space-y-1.5 rounded-lg bg-white border border-slate-100 p-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="w-28 text-gray-700">{getName(uid)}</span>
                  <span className="text-gray-400">ทำงานร่วมกันได้ดีแค่ไหน</span>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      onClick={() =>
                        setDrafts((prev) => ({ ...prev, [uid]: { comment: '', ...prev[uid], score } }))
                      }
                      className={`h-7 w-7 rounded-lg font-semibold cursor-pointer ${
                        drafts[uid]?.score === score
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-slate-200 text-gray-600 hover:bg-indigo-50'
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="gt-input !py-1.5 text-xs flex-1"
                    placeholder="คำบรรยาย เช่น ช่วยแบ่งงานดี ตอบแชทช้า (ไม่บังคับ)"
                    value={drafts[uid]?.comment || ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [uid]: { score: 0, ...prev[uid], comment: e.target.value } }))
                    }
                  />
                  <button onClick={() => handleSendFeedback(uid)} disabled={busy} className={`${btn} bg-indigo-600 text-white`}>
                    ส่ง
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
