'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase'
import { logActivity } from '@/lib/logActivity'

interface Member {
  user_id: string
  role: string
  full_name: string | null
  email: string | null
}

interface Round {
  round_id: string
  title: string
  status: 'open' | 'closed'
  created_at: string
}

interface ResultRow {
  evaluatee_id: string
  responses: number
  avg_responsibility: number
  avg_quality: number
  avg_teamwork: number
  comments: string[]
}

type Criterion = 'responsibility' | 'quality' | 'teamwork'

const CRITERIA: { key: Criterion; label: string }[] = [
  { key: 'responsibility', label: 'ความรับผิดชอบ' },
  { key: 'quality', label: 'คุณภาพงาน' },
  { key: 'teamwork', label: 'การทำงานร่วมกัน' },
]

type Draft = { responsibility: number; quality: number; teamwork: number; comment: string }

const card = 'bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6'
const solidBtn =
  'px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-60 cursor-pointer'

// การประเมินโดยเพื่อนแบบเป็นรอบ: หัวหน้าเปิด/ปิดรอบและดูผล สมาชิกประเมินเพื่อนสมาชิก
export default function PeerEvaluation({
  groupId,
  currentUserId,
  isLeader,
  members,
}: {
  groupId: string
  currentUserId: string
  isLeader: boolean
  members: Member[]
}) {
  const supabase = createClient()
  const [rounds, setRounds] = useState<Round[]>([])
  const [submittedCount, setSubmittedCount] = useState<Record<string, number>>({})
  // รอบที่ผู้ใช้คนนี้ส่งแบบประเมินแล้ว
  const [mySubmitted, setMySubmitted] = useState<string[]>([])
  const [results, setResults] = useState<Record<string, ResultRow[]>>({})
  const [newTitle, setNewTitle] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // หัวหน้าไม่ประเมินและไม่ถูกประเมิน
  const evaluators = members.filter((m) => m.role !== 'leader')
  const peers = evaluators.filter((m) => m.user_id !== currentUserId)
  const openRound = rounds.find((r) => r.status === 'open')

  const getName = (userId: string) => {
    const m = members.find((item) => item.user_id === userId)
    return m?.full_name || m?.email || 'สมาชิก'
  }

  const load = useCallback(async () => {
    const { data: roundRows, error: roundErr } = await supabase
      .from('eval_rounds')
      .select('round_id, title, status, created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })

    if (roundErr) {
      setMessage({ type: 'error', text: `โหลดรอบการประเมินไม่สำเร็จ: ${roundErr.message}` })
      setLoading(false)
      return
    }
    setRounds(roundRows || [])

    const counts: Record<string, number> = {}
    for (const r of roundRows || []) {
      const { data: count } = await supabase.rpc('peer_eval_submitted_count', { p_round_id: r.round_id })
      counts[r.round_id] = count ?? 0
    }
    setSubmittedCount(counts)

    const { data: mine } = await supabase
      .from('peer_evaluations')
      .select('round_id')
      .eq('group_id', groupId)
      .eq('evaluator_id', currentUserId)
    setMySubmitted(Array.from(new Set((mine || []).map((e) => e.round_id))))
    setLoading(false)
  }, [groupId, currentUserId, supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const handleOpenRound = async () => {
    const title = newTitle.trim()
    if (!title) return

    setBusy(true)
    setMessage(null)
    const { error } = await supabase
      .from('eval_rounds')
      .insert({ group_id: groupId, title, created_by: currentUserId })

    if (error) {
      setMessage({ type: 'error', text: `เปิดรอบไม่สำเร็จ: ${error.message}` })
    } else {
      await logActivity(supabase, {
        groupId,
        action: 'eval_round_opened',
        entityType: 'group',
        entityId: groupId,
        payload: { title },
      })
      setNewTitle('')
      await load()
    }
    setBusy(false)
  }

  const handleCloseRound = async (round: Round) => {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase
      .from('eval_rounds')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('round_id', round.round_id)

    if (error) {
      setMessage({ type: 'error', text: `ปิดรอบไม่สำเร็จ: ${error.message}` })
    } else {
      await logActivity(supabase, {
        groupId,
        action: 'eval_round_closed',
        entityType: 'group',
        entityId: groupId,
        payload: { title: round.title },
      })
      await load()
      await handleShowResults(round)
    }
    setBusy(false)
  }

  async function handleShowResults(round: Round) {
    setMessage(null)
    const { data, error } = await supabase.rpc('get_peer_eval_results', { p_round_id: round.round_id })
    if (error) {
      setMessage({ type: 'error', text: `โหลดผลการประเมินไม่สำเร็จ: ${error.message}` })
      return
    }
    setResults((prev) => ({ ...prev, [round.round_id]: data || [] }))
  }

  const setDraft = (userId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [userId]: { responsibility: 0, quality: 0, teamwork: 0, comment: '', ...prev[userId], ...patch },
    }))
  }

  const handleSubmit = async () => {
    if (!openRound) return
    const incomplete = peers.some((p) => {
      const d = drafts[p.user_id]
      return !d || !d.responsibility || !d.quality || !d.teamwork
    })
    if (incomplete) {
      setMessage({ type: 'error', text: 'กรุณาให้คะแนนเพื่อนทุกคนให้ครบทั้ง 3 ด้าน' })
      return
    }

    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('peer_evaluations').insert(
      peers.map((p) => ({
        round_id: openRound.round_id,
        group_id: groupId,
        evaluator_id: currentUserId,
        evaluatee_id: p.user_id,
        responsibility: drafts[p.user_id].responsibility,
        quality: drafts[p.user_id].quality,
        teamwork: drafts[p.user_id].teamwork,
        comment: drafts[p.user_id].comment.trim() || null,
      }))
    )

    if (error) {
      setMessage({ type: 'error', text: `ส่งแบบประเมินไม่สำเร็จ: ${error.message}` })
    } else {
      setMessage({ type: 'success', text: 'ส่งแบบประเมินเรียบร้อยแล้ว ขอบคุณค่ะ' })
      setDrafts({})
      await load()
    }
    setBusy(false)
  }

  if (loading) {
    return <div className={`${card} text-center text-sm text-gray-400`}>กำลังโหลดการประเมิน...</div>
  }

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs ${
            message.type === 'error'
              ? 'bg-rose-50 border-rose-100 text-rose-700'
              : 'bg-emerald-50 border-emerald-100 text-emerald-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className={card}>
        <h2 className="text-base font-semibold text-gray-800">การประเมินโดยเพื่อน</h2>
        <p className="mt-1 text-xs text-gray-500">
          สมาชิกให้คะแนนเพื่อนสมาชิก 3 ด้าน (1 = น้อยที่สุด, 5 = มากที่สุด) โดยไม่เปิดเผยชื่อผู้ประเมิน
          หัวหน้าเห็นเฉพาะค่าเฉลี่ยและคำบรรยายหลังปิดรอบ และคะแนนที่ส่งแล้วแก้ไขไม่ได้
        </p>

        {isLeader && !openRound && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <input
              className="gt-input flex-1 min-w-[200px] !py-2 text-sm"
              placeholder="ชื่อรอบ เช่น รอบกลางโครงการ"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <button onClick={handleOpenRound} disabled={busy || !newTitle.trim()} className={solidBtn}>
              เปิดรอบประเมิน
            </button>
          </div>
        )}
        {isLeader && evaluators.length < 2 && (
          <p className="mt-3 text-xs text-amber-700">
            ต้องมีสมาชิก (ไม่นับหัวหน้า) อย่างน้อย 2 คน จึงจะประเมินกันได้
          </p>
        )}
      </div>

      {/* แบบประเมินของสมาชิก สำหรับรอบที่เปิดอยู่ */}
      {!isLeader && openRound && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-gray-800">แบบประเมิน: {openRound.title}</h3>

          {mySubmitted.includes(openRound.round_id) ? (
            <p className="mt-3 text-sm text-emerald-700">คุณส่งแบบประเมินรอบนี้แล้ว</p>
          ) : peers.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">ยังไม่มีเพื่อนสมาชิกคนอื่นให้ประเมิน</p>
          ) : (
            <div className="mt-4 space-y-4">
              {peers.map((p) => (
                <div key={p.user_id} className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-2.5">
                  <p className="text-sm font-semibold text-gray-800">{getName(p.user_id)}</p>
                  {CRITERIA.map((c) => (
                    <div key={c.key} className="flex items-center gap-2 flex-wrap">
                      <span className="w-32 text-xs text-gray-600">{c.label}</span>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={score}
                          onClick={() => setDraft(p.user_id, { [c.key]: score })}
                          className={`h-8 w-8 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            drafts[p.user_id]?.[c.key] === score
                              ? 'bg-indigo-600 text-white'
                              : 'bg-white border border-slate-200 text-gray-600 hover:bg-indigo-50'
                          }`}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  ))}
                  <input
                    className="gt-input !py-1.5 text-xs"
                    placeholder="คำบรรยายเพิ่มเติม เช่น จุดเด่น หรือสิ่งที่อยากให้ปรับ (ไม่บังคับ)"
                    value={drafts[p.user_id]?.comment || ''}
                    onChange={(e) => setDraft(p.user_id, { comment: e.target.value })}
                  />
                </div>
              ))}
              <button onClick={handleSubmit} disabled={busy} className={solidBtn}>
                ส่งแบบประเมิน (ส่งแล้วแก้ไขไม่ได้)
              </button>
            </div>
          )}
        </div>
      )}

      {/* รายการรอบทั้งหมด */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-gray-800">รอบการประเมินทั้งหมด</h3>
        {rounds.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">ยังไม่มีรอบการประเมิน</p>
        ) : (
          <div className="mt-3 space-y-3">
            {rounds.map((r) => (
              <div key={r.round_id} className="rounded-xl border border-slate-100 p-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {r.title}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          r.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {r.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">
                      ส่งแล้ว {submittedCount[r.round_id] ?? 0} จาก {evaluators.length} คน
                    </p>
                  </div>
                  {isLeader && r.status === 'open' && (
                    <button onClick={() => handleCloseRound(r)} disabled={busy} className={solidBtn}>
                      ปิดรอบและดูผล
                    </button>
                  )}
                  {isLeader && r.status === 'closed' && !results[r.round_id] && (
                    <button onClick={() => handleShowResults(r)} className={solidBtn}>
                      ดูผลการประเมิน
                    </button>
                  )}
                </div>

                {results[r.round_id] && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {results[r.round_id].length === 0 && (
                      <p className="text-xs text-gray-500">ไม่มีผู้ส่งแบบประเมินในรอบนี้</p>
                    )}
                    {results[r.round_id].map((row) => (
                      <div key={row.evaluatee_id} className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                        <p className="text-sm font-semibold text-gray-800">
                          {getName(row.evaluatee_id)}
                          <span className="ml-2 text-[11px] font-normal text-gray-400">
                            จากผู้ประเมิน {row.responses} คน
                          </span>
                        </p>
                        <p className="text-xs text-gray-600">
                          ความรับผิดชอบ <strong>{row.avg_responsibility}</strong> · คุณภาพงาน{' '}
                          <strong>{row.avg_quality}</strong> · การทำงานร่วมกัน <strong>{row.avg_teamwork}</strong>
                        </p>
                        {row.comments.length > 0 && (
                          <ul className="list-disc pl-4 text-xs text-gray-500 space-y-0.5">
                            {row.comments.map((text, i) => (
                              <li key={i}>{text}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
