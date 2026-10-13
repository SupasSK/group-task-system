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

const PROGRESS_STEPS = [0, 25, 50, 75, 100]

// หลอดความคืบหน้า + ลิงก์ผลงาน + บันทึกของงานหนึ่งงาน
export default function TaskWorkPanel({
  task,
  currentUserId,
  canEdit,
}: {
  task: {
    task_id: string
    group_id: string
    title: string
    status: string
    work_url?: string | null
    progress?: number | null
  }
  currentUserId: string | null
  // ผู้รับผิดชอบงานหรือหัวหน้าเท่านั้นที่แก้ลิงก์และความคืบหน้าได้
  canEdit: boolean
}) {
  const supabase = createClient()
  const [url, setUrl] = useState(task.work_url || '')
  const [progress, setProgress] = useState(task.progress ?? 0)
  // ฟอร์มที่เปิดอยู่: แนบลิงก์ / อัปเดตความคืบหน้า
  const [form, setForm] = useState<'link' | 'progress' | null>(null)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftProgress, setDraftProgress] = useState(0)
  const [progressNote, setProgressNote] = useState('')

  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [kind, setKind] = useState<TaskNote['kind']>('comment')
  const [body, setBody] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // งานที่เสร็จแล้วถือว่าคืบหน้า 100% เสมอ
  const shownProgress = task.status === 'completed' ? 100 : progress

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

  const insertNote = async (noteKind: TaskNote['kind'], text: string) => {
    const { error: insertErr } = await supabase.from('task_comments').insert({
      group_id: task.group_id,
      task_id: task.task_id,
      author_id: currentUserId,
      kind: noteKind,
      body: text,
    })
    if (insertErr) return insertErr.message

    await logActivity(supabase, {
      groupId: task.group_id,
      action: noteKind === 'decision' ? 'decision_added' : 'comment_added',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, preview: text.slice(0, 80) },
    })
    return null
  }

  const handleToggleNotes = async () => {
    setShowNotes(!showNotes)
    if (!showNotes) await loadNotes()
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
    setForm(null)
    setBusy(false)
  }

  const handleSaveProgress = async () => {
    const text = progressNote.trim()
    if (!text) {
      setError('กรุณาเขียนสั้น ๆ ว่าทำอะไรไปบ้าง')
      return
    }
    if (!currentUserId) return

    setBusy(true)
    setError(null)
    if (draftProgress !== progress) {
      const { error: updateErr } = await supabase
        .from('tasks')
        .update({ progress: draftProgress, updated_at: new Date().toISOString() })
        .eq('task_id', task.task_id)

      if (updateErr) {
        setError(`บันทึกความคืบหน้าไม่สำเร็จ: ${updateErr.message}`)
        setBusy(false)
        return
      }

      await logActivity(supabase, {
        groupId: task.group_id,
        action: 'task_updated',
        entityType: 'task',
        entityId: task.task_id,
        payload: { title: task.title, changes: { progress: { from: progress, to: draftProgress } } },
      })
      setProgress(draftProgress)
    }

    const noteErr = await insertNote('comment', text)
    if (noteErr) setError(`บันทึกไม่สำเร็จ: ${noteErr}`)

    setProgressNote('')
    setForm(null)
    if (showNotes) await loadNotes()
    setBusy(false)
  }

  const handleAddNote = async () => {
    const text = body.trim()
    if (!text || !currentUserId) return

    setBusy(true)
    setError(null)
    const noteErr = await insertNote(kind, text)
    if (noteErr) {
      setError(`บันทึกไม่สำเร็จ: ${noteErr}`)
    } else {
      setBody('')
      await loadNotes()
    }
    setBusy(false)
  }

  const outlineBtn =
    'px-3 py-1.5 rounded-lg border border-indigo-200 bg-white text-indigo-700 font-semibold hover:bg-indigo-50 transition cursor-pointer'
  const solidBtn =
    'px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer'

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-3 text-xs">
      {/* หลอดความคืบหน้า */}
      <div className="flex items-center gap-3">
        <span className="shrink-0 font-semibold text-gray-600">ความคืบหน้า</span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all ${shownProgress === 100 ? 'bg-emerald-500' : 'gt-gradient-x'}`}
            style={{ width: `${shownProgress}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-right font-bold text-gray-700">{shownProgress}%</span>
      </div>

      {/* ปุ่มหลัก */}
      <div className="flex items-center gap-2 flex-wrap">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className={solidBtn}>
            🔗 เปิดผลงาน
          </a>
        ) : (
          <span className="text-gray-400">ยังไม่มีลิงก์ผลงาน</span>
        )}
        {canEdit && (
          <button
            onClick={() => {
              setDraftUrl(url)
              setError(null)
              setForm(form === 'link' ? null : 'link')
            }}
            className={outlineBtn}
          >
            {url ? 'แก้ไขลิงก์' : '+ แนบลิงก์ผลงาน'}
          </button>
        )}
        {canEdit && task.status !== 'completed' && (
          <button
            onClick={() => {
              setDraftProgress(progress)
              setError(null)
              setForm(form === 'progress' ? null : 'progress')
            }}
            className={outlineBtn}
          >
            📈 อัปเดตความคืบหน้า
          </button>
        )}
        <button onClick={handleToggleNotes} className={outlineBtn}>
          {showNotes ? 'ซ่อนบันทึก' : '💬 ดูบันทึกของงานนี้'}
        </button>
      </div>

      {form === 'link' && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="gt-input flex-1 min-w-[200px] !py-1.5 text-xs"
            placeholder="วางลิงก์ Google Docs, Slides, Canva ฯลฯ"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
          />
          <button onClick={handleSaveLink} disabled={busy} className={solidBtn}>
            บันทึกลิงก์
          </button>
        </div>
      )}

      {form === 'progress' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-gray-500">ทำไปแล้ว</span>
            {PROGRESS_STEPS.map((step) => (
              <button
                key={step}
                onClick={() => setDraftProgress(step)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  draftProgress === step
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white border border-slate-200 text-gray-600 hover:bg-indigo-50'
                }`}
              >
                {step}%
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="gt-input flex-1 min-w-[200px] !py-1.5 text-xs"
              placeholder="ทำอะไรไปบ้าง เช่น แก้บทที่ 2 เพิ่มรูปประกอบแล้ว"
              value={progressNote}
              onChange={(e) => setProgressNote(e.target.value)}
            />
            <button onClick={handleSaveProgress} disabled={busy} className={solidBtn}>
              บันทึกความคืบหน้า
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-rose-600">{error}</p>}

      {showNotes && (
        <div className="space-y-2 border-t border-slate-200 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="gt-input !w-auto !py-1.5 text-xs"
              value={kind}
              onChange={(e) => setKind(e.target.value as TaskNote['kind'])}
            >
              <option value="comment">ความเห็น</option>
              <option value="decision">การตัดสินใจ</option>
            </select>
            <input
              className="gt-input flex-1 min-w-[180px] !py-1.5 text-xs"
              placeholder={kind === 'decision' ? 'เช่น ตกลงเปลี่ยนหัวข้อบทที่ 3 เพราะ...' : 'เขียนความเห็นถึงเพื่อนในกลุ่ม'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <button onClick={handleAddNote} disabled={busy || !body.trim()} className={solidBtn}>
              ส่ง
            </button>
          </div>

          {notes.length === 0 ? (
            <p className="text-gray-400">ยังไม่มีบันทึกในงานนี้</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => (
                <li key={n.comment_id} className="text-gray-600">
                  {n.kind === 'decision' && (
                    <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      การตัดสินใจ
                    </span>
                  )}
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
