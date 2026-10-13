'use client'
import { useState } from 'react'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'

interface TaskNote {
  comment_id: string
  author_id: string
  kind: 'comment' | 'decision'
  body: string
  created_at: string
}

// ลิงก์ผลงาน + บันทึกความคืบหน้า/การตัดสินใจของงานหนึ่งงาน
export default function TaskWorkPanel({
  task,
  currentUserId,
  canEditLink,
}: {
  task: { task_id: string; group_id: string; title: string; work_url?: string | null }
  currentUserId: string | null
  // ผู้รับผิดชอบงานหรือหัวหน้าเท่านั้นที่แก้ลิงก์ผลงานได้
  canEditLink: boolean
}) {
  const supabase = createClient()
  const [url, setUrl] = useState(task.work_url || '')
  const [editingLink, setEditingLink] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')

  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [kind, setKind] = useState<TaskNote['kind']>('comment')
  const [body, setBody] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadNotes = async () => {
    const { data, error: noteErr } = await supabase
      .from('task_comments')
      .select('comment_id, author_id, kind, body, created_at')
      .eq('task_id', task.task_id)
      .order('created_at', { ascending: false })

    if (noteErr) {
      setError(`โหลดบันทึกไม่สำเร็จ: ${noteErr.message}`)
      return
    }
    setNotes(data || [])

    const authorIds = Array.from(new Set((data || []).map((n) => n.author_id)))
    if (authorIds.length > 0) {
      const { data: userRows } = await supabase
        .from('users')
        .select('user_id, full_name, email')
        .in('user_id', authorIds)
      const map: Record<string, string> = {}
      for (const u of userRows || []) map[u.user_id] = u.full_name || u.email || 'สมาชิก'
      setNames(map)
    }
  }

  const handleToggle = async () => {
    setOpen(!open)
    if (!open) await loadNotes()
  }

  const handleSaveLink = async () => {
    const next = draftUrl.trim()
    if (next && !/^https?:\/\//i.test(next)) {
      setError('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://')
      return
    }

    setBusy(true)
    setError(null)
    const { error: updateErr } = await supabase
      .from('tasks')
      .update({ work_url: next || null, updated_at: new Date().toISOString() })
      .eq('task_id', task.task_id)

    if (updateErr) {
      setError(`บันทึกลิงก์ไม่สำเร็จ: ${updateErr.message}`)
      setBusy(false)
      return
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_updated',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, changes: { work_url: { from: url || null, to: next || null } } },
    })

    setUrl(next)
    setEditingLink(false)
    setBusy(false)
  }

  const handleAddNote = async () => {
    const text = body.trim()
    if (!text || !currentUserId) return

    setBusy(true)
    setError(null)
    const { error: insertErr } = await supabase.from('task_comments').insert({
      group_id: task.group_id,
      task_id: task.task_id,
      author_id: currentUserId,
      kind,
      body: text,
    })

    if (insertErr) {
      setError(`บันทึกไม่สำเร็จ: ${insertErr.message}`)
      setBusy(false)
      return
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: kind === 'decision' ? 'decision_added' : 'comment_added',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, preview: text.slice(0, 80) },
    })

    setBody('')
    await loadNotes()
    setBusy(false)
  }

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {editingLink ? (
          <div className="flex flex-1 items-center gap-2 min-w-[220px]">
            <input
              className="gt-input flex-1 !py-1.5 text-xs"
              placeholder="วางลิงก์ Google Docs, Slides, Canva ฯลฯ"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
            />
            <button
              onClick={handleSaveLink}
              disabled={busy}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer"
            >
              บันทึก
            </button>
            <button onClick={() => setEditingLink(false)} className="text-gray-500 hover:underline cursor-pointer">
              ยกเลิก
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-600 hover:underline">
                🔗 เปิดผลงาน
              </a>
            ) : (
              <span className="text-gray-400">ยังไม่มีลิงก์ผลงาน</span>
            )}
            {canEditLink && (
              <button
                onClick={() => {
                  setDraftUrl(url)
                  setError(null)
                  setEditingLink(true)
                }}
                className="text-gray-500 hover:text-indigo-600 hover:underline cursor-pointer"
              >
                {url ? 'แก้ไขลิงก์' : '+ แนบลิงก์ผลงาน'}
              </button>
            )}
          </div>
        )}

        <button onClick={handleToggle} className="text-gray-500 hover:text-indigo-600 hover:underline cursor-pointer">
          {open ? 'ซ่อนความคืบหน้า' : '💬 ความคืบหน้าและการตัดสินใจ'}
        </button>
      </div>

      {error && <p className="text-rose-600">{error}</p>}

      {open && (
        <div className="space-y-2 border-t border-slate-200 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="gt-input !w-auto !py-1.5 text-xs"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskNote['kind'])}
            >
              <option value="comment">อัปเดตความคืบหน้า</option>
              <option value="decision">บันทึกการตัดสินใจ</option>
            </select>
            <input
              className="gt-input flex-1 min-w-[180px] !py-1.5 text-xs"
              placeholder={kind === 'decision' ? 'เช่น ตกลงเปลี่ยนหัวข้อบทที่ 3 เพราะ...' : 'เช่น แก้บทที่ 2 เพิ่มรูปประกอบแล้ว'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <button
              onClick={handleAddNote}
              disabled={busy || !body.trim()}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer"
            >
              บันทึก
            </button>
          </div>

          {notes.length === 0 ? (
            <p className="text-gray-400">ยังไม่มีบันทึกในงานนี้</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.comment_id} className="text-gray-600">
                  <span
                    className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      n.kind === 'decision' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {n.kind === 'decision' ? 'การตัดสินใจ' : 'ความคืบหน้า'}
                  </span>
                  <span className="font-semibold text-gray-700">{names[n.author_id] || 'สมาชิก'}</span>: {n.body}
                  <span className="text-gray-400">
                    {' '}· {new Date(n.created_at).toLocaleDateString('th-TH', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
