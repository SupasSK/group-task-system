// เกณฑ์ฉบับที่ 4 KPI-4 ความปลอดภัย ส่วนการเข้าถึง: เรียก Supabase REST / RPC / Storage ตรง ๆ ด้วย token ของแต่ละบทบาท
// ผลที่คาด (expect) ของทุกกรณี commit ไว้ก่อนรันรอบจริง รหัสกรณีตรงกับตารางในเกณฑ์ฉบับที่ 4
//   deny  = ต้องทำไม่ได้ (error หรือไม่มีผลต่อข้อมูลจริง)   allow = ต้องทำได้   safe = injection ต้องไม่มีผลข้างเคียง
// P6-02 (token หมดอายุ) ใช้ token ที่สคริปต์เก็บไว้ใน evaluation/.tokens.json จากการรันครั้งก่อน
//   ต้องรันอย่างน้อย 1 ครั้ง (เช่น pilot) ก่อนรอบจริงไม่น้อยกว่าอายุ token (ค่าเริ่มต้น 1 ชั่วโมง) ไม่อย่างนั้นกรณีนี้ไม่ผ่าน
// วิธีรัน: node v4-kpi4-access.mjs <round> <run>   เช่น 1 1 แล้ว 1 2   หรือ   node v4-kpi4-access.mjs pilot
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { signInAs, newClient, nowIso, HERE, SUPABASE_URL, ANON_KEY } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'
import { must, code6, logAs, createGroup, writeResult } from './v4-lib.mjs'

const pilot = process.argv[2] === 'pilot'
const round = pilot ? 0 : Number(process.argv[2])
const run = pilot ? 0 : Number(process.argv[3])
if (!pilot && (!round || !run)) throw new Error('ใช้: node v4-kpi4-access.mjs <round> <run> หรือ pilot')
const label = pilot ? 'pilot' : `r${round} run${run}`
const PREFIX = '[TEST] v4 KPI-4'
const TOKENS = join(HERE, '.tokens.json')
const png = (bytes = 4) => { const a = new Uint8Array(bytes); a.set([137, 80, 78, 71]); return new Blob([a], { type: 'image/png' }) }

// ---------- ตัวช่วยตัดสินผล ----------
async function sel(q) {
  const { data, error } = await q
  return { allowed: !error && Array.isArray(data) && data.length > 0, detail: error?.message ?? `${data?.length ?? 0} rows` }
}
async function ok(q) {
  const { error } = await q
  return { allowed: !error, detail: error?.message ?? 'no error' }
}
async function rpcData(q) {
  const { data, error } = await q
  const empty = data === null || data === undefined || (Array.isArray(data) && data.length === 0)
  return { allowed: !error && !empty, detail: error?.message ?? JSON.stringify(data)?.slice(0, 80) }
}
async function state(q, check) {
  const { error } = await q
  const changed = await check()
  return { allowed: changed, detail: error?.message ?? (changed ? 'changed' : 'unchanged') }
}
async function rest(token, path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => null)
  return { allowed: res.ok && Array.isArray(body) && body.length > 0, detail: `HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 80)}` }
}
const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8')
const jwtPayload = (t) => JSON.parse(b64(t.split('.')[1]))

async function main() {
  // ---------- บัญชี ----------
  const L = await signInAs('leader', 'ผู้ทดสอบ หัวหน้า')
  const M = await signInAs('member', 'ผู้ทดสอบ สมาชิก')
  const M2 = await signInAs('member2', 'ผู้ทดสอบ สมาชิกสอง')
  const C = await signInAs('collab', 'ผู้ทดสอบ ผู้ร่วมทำ')
  const O = await signInAs('outsider', 'ผู้ทดสอบ คนนอก')
  const R = await signInAs('removed', 'ผู้ทดสอบ ถูกนำออก')
  const A = { client: newClient() }
  const tokenOf = async (u) => (await u.client.auth.getSession()).data.session.access_token
  const mToken = await tokenOf(M)

  // ---------- fixture ----------
  const G = await createGroup(L, `${PREFIX} ${label}`, [M, M2, C, R])
  const gid = G.group_id
  const joinCode = G.join_code
  const FUTURE = '2026-12-31T10:00:00Z'
  const mkTask = async (title, extra) => must(await L.client.from('tasks').insert({
    group_id: gid, title, priority: 'medium', difficulty: 'medium', headcount: 2, assigned_by: L.user.id, updated_at: nowIso(),
    status: 'assigned', assignment_type: 'leader_assign', ...extra,
  }).select().single(), `task ${title}`)
  const T1 = await mkTask('T1 ของสมาชิก', { assigned_to: M.user.id })
  const T2 = await mkTask('T2 งานว่าง', { assigned_to: null, status: 'pending', assignment_type: 'open_choice' })
  const T3 = await mkTask('T3 ของสมาชิกสอง', { assigned_to: M2.user.id })
  const T4 = await mkTask('T4 หลายคน', { assigned_to: M2.user.id, headcount: 3, deadline: FUTURE })
  const TD = await mkTask('TD สำหรับทดสอบลบ', { assigned_to: M.user.id })
  for (const t of [T1, T3]) {
    must(await L.client.from('task_collaborators').insert({ task_id: t.task_id, group_id: gid, user_id: C.user.id, status: 'pending' }), 'invite C')
    must(await C.client.from('task_collaborators').update({ status: 'accepted', responded_at: nowIso() }).eq('task_id', t.task_id).eq('user_id', C.user.id), 'C accepts')
  }
  must(await M2.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T3.task_id), 'complete T3')
  must(await C.client.from('task_feedback').insert({ task_id: T3.task_id, group_id: gid, from_user: C.user.id, to_user: M2.user.id, score: 4, comment: 'fixture' }), 'feedback')
  must(await M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M.user.id, kind: 'comment', body: 'fixture comment' }), 'comment')
  await logAs(M, gid, 'comment_added', 'task', T1.task_id, { title: T1.title, preview: 'fixture comment' })
  const ER = must(await L.client.from('eval_rounds').insert({ group_id: gid, title: 'รอบทดสอบ', created_by: L.user.id }).select().single(), 'eval round')
  const pe = (from, to) => ({ round_id: ER.round_id, group_id: gid, evaluator_id: from.user.id, evaluatee_id: to.user.id, responsibility: 4, quality: 4, teamwork: 4, comment: 'fixture' })
  must(await M.client.from('peer_evaluations').insert(pe(M, M2)), 'pe M->M2')
  must(await M.client.from('group_visits').upsert({ user_id: M.user.id, group_id: gid, last_seen_at: nowIso() }, { onConflict: 'user_id,group_id' }), 'visit')
  must(await L.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: R.user.id }), 'remove R')
  // กลุ่มที่เก็บเข้าคลังแล้ว สำหรับ P8-13
  const GA = await createGroup(L, `${PREFIX} archived ${label}`, [M])
  const TA = must(await L.client.from('tasks').insert({ group_id: GA.group_id, title: 'งานในกลุ่มที่เก็บเข้าคลัง', priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: L.user.id, updated_at: nowIso() }).select().single(), 'archived task')
  must(await L.client.rpc('archive_group', { p_group_id: GA.group_id }), 'archive GA')

  const comment = must(await M.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id).single(), 'read comment')
  const logRow = must(await L.client.from('activity_logs').select('log_id').eq('group_id', gid).limit(1).single(), 'read log')
  const feedback = must(await C.client.from('task_feedback').select('feedback_id').eq('task_id', T3.task_id).single(), 'read feedback')
  const myPe = must(await M.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id).single(), 'read pe')
  const mGroups = new Set(must(await M.client.from('group_members').select('group_id').eq('user_id', M.user.id), 'M groups').map((r) => r.group_id))

  // token หมดอายุจากการรันครั้งก่อน (P6-02)
  const saved = existsSync(TOKENS) ? JSON.parse(readFileSync(TOKENS, 'utf8')) : []
  const expired = saved.find((t) => jwtPayload(t).exp * 1000 < Date.now())
  writeFileSync(TOKENS, JSON.stringify([...saved.filter((t) => jwtPayload(t).exp * 1000 >= Date.now()), mToken].slice(-5)))

  // ตัวอ่านสถานะจริง
  const taskField = async (t, col) => (await L.client.from('tasks').select(col).eq('task_id', t.task_id).single()).data?.[col]
  const taskExists = async (t) => !!(await L.client.from('tasks').select('task_id').eq('task_id', t.task_id).maybeSingle()).data
  const isMember = async (u) => !!(await L.client.from('group_members').select('user_id').eq('group_id', gid).eq('user_id', u.user.id).maybeSingle()).data
  const roleOf = async (u) => (await L.client.from('group_members').select('role').eq('group_id', gid).eq('user_id', u.user.id).maybeSingle()).data?.role
  const groupField = async (col) => (await L.client.from('groups').select(col).eq('group_id', gid).single()).data?.[col]
  const logCount = async () => (await L.client.from('activity_logs').select('log_id', { count: 'exact', head: true }).eq('group_id', gid)).count
  const logVia = (u, preview) => async () => {
    const before = await logCount()
    const r = await u.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: 'x', preview } })
    const after = await logCount()
    return { allowed: after > before, detail: r.error?.message ?? `count ${before}->${after}` }
  }
  const taskInsert = (u, title) => ok(u.client.from('tasks').insert({ group_id: gid, title, priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: u.user.id, updated_at: nowIso() }))

  // ---------- กรณีทดสอบ (รันตามลำดับ กรณีที่เปลี่ยนข้อมูลมากอยู่ท้าย) ----------
  const cases = [
    // หลักที่ 1 คนนอกเข้าไม่ได้
    ['P1-01', 'anon', 'deny', 'อ่าน groups', () => sel(A.client.from('groups').select('group_id').eq('group_id', gid))],
    ['P1-02', 'outsider', 'deny', 'อ่าน groups', () => sel(O.client.from('groups').select('group_id').eq('group_id', gid))],
    ['P1-03', 'removed', 'deny', 'อ่าน groups หลังถูกนำออก', () => sel(R.client.from('groups').select('group_id').eq('group_id', gid))],
    ['P1-04', 'anon', 'deny', 'อ่าน group_members', () => sel(A.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['P1-05', 'outsider', 'deny', 'อ่าน group_members', () => sel(O.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['P1-06', 'removed', 'deny', 'อ่าน group_members หลังถูกนำออก', () => sel(R.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['P1-07', 'outsider', 'deny', 'เพิ่มตัวเองเข้ากลุ่มโดยตรง', () => ok(O.client.from('group_members').insert({ group_id: gid, user_id: O.user.id, role: 'member' }))],
    ['P1-08', 'anon', 'deny', 'อ่าน tasks', () => sel(A.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['P1-09', 'outsider', 'deny', 'อ่าน tasks', () => sel(O.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['P1-10', 'removed', 'deny', 'อ่าน tasks หลังถูกนำออก', () => sel(R.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['P1-11', 'outsider', 'deny', 'สร้างงาน', () => taskInsert(O, 'P1-11')],
    ['P1-12', 'anon', 'deny', 'อ่าน task_responses', () => sel(A.client.from('task_responses').select('*').eq('task_id', T1.task_id))],
    ['P1-13', 'outsider', 'deny', 'อ่าน task_responses', () => sel(O.client.from('task_responses').select('*').eq('task_id', T1.task_id))],
    ['P1-14', 'outsider', 'deny', 'บันทึกการรับงาน', () => ok(O.client.from('task_responses').insert({ task_id: T1.task_id, user_id: O.user.id, response: 'accepted' }))],
    ['P1-15', 'anon', 'deny', 'อ่าน task_comments', () => sel(A.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id))],
    ['P1-16', 'outsider', 'deny', 'อ่าน task_comments', () => sel(O.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id))],
    ['P1-17', 'removed', 'deny', 'อ่าน task_comments หลังถูกนำออก', () => sel(R.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id))],
    ['P1-18', 'outsider', 'deny', 'เขียนความเห็น', () => ok(O.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: O.user.id, kind: 'comment', body: 'P1-18' }))],
    ['P1-19', 'anon', 'deny', 'อ่าน activity_logs', () => sel(A.client.from('activity_logs').select('log_id').eq('group_id', gid))],
    ['P1-20', 'outsider', 'deny', 'อ่าน activity_logs', () => sel(O.client.from('activity_logs').select('log_id').eq('group_id', gid))],
    ['P1-21', 'removed', 'deny', 'อ่าน activity_logs หลังถูกนำออก', () => sel(R.client.from('activity_logs').select('log_id').eq('group_id', gid))],
    ['P1-22', 'anon', 'deny', 'อ่าน task_collaborators', () => sel(A.client.from('task_collaborators').select('user_id').eq('group_id', gid))],
    ['P1-23', 'outsider', 'deny', 'อ่าน task_collaborators', () => sel(O.client.from('task_collaborators').select('user_id').eq('group_id', gid))],
    ['P1-24', 'outsider', 'deny', 'เข้าร่วมงานว่างเอง', () => ok(O.client.from('task_collaborators').insert({ task_id: T2.task_id, group_id: gid, user_id: O.user.id, status: 'accepted' }))],
    ['P1-25', 'anon', 'deny', 'อ่าน task_feedback', () => sel(A.client.from('task_feedback').select('feedback_id').eq('group_id', gid))],
    ['P1-26', 'outsider', 'deny', 'อ่าน task_feedback', () => sel(O.client.from('task_feedback').select('feedback_id').eq('group_id', gid))],
    ['P1-27', 'anon', 'deny', 'อ่าน eval_rounds', () => sel(A.client.from('eval_rounds').select('round_id').eq('group_id', gid))],
    ['P1-28', 'outsider', 'deny', 'อ่าน eval_rounds', () => sel(O.client.from('eval_rounds').select('round_id').eq('group_id', gid))],
    ['P1-29', 'anon', 'deny', 'อ่าน peer_evaluations', () => sel(A.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id))],
    ['P1-30', 'outsider', 'deny', 'อ่าน peer_evaluations', () => sel(O.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id))],
    ['P1-31', 'anon', 'deny', 'อ่าน group_visits', () => sel(A.client.from('group_visits').select('*').eq('group_id', gid))],
    ['P1-32', 'outsider', 'deny', 'อ่าน group_visits', () => sel(O.client.from('group_visits').select('*').eq('group_id', gid))],
    ['P1-33', 'anon', 'deny', 'อ่าน integrity_checks ของกลุ่มใดก็ได้', () => sel(A.client.from('integrity_checks').select('check_id').limit(1))],
    ['P1-34', 'outsider', 'deny', 'อ่าน integrity_checks ของกลุ่มใดก็ได้', () => sel(O.client.from('integrity_checks').select('check_id').limit(1))],
    ['P1-35', 'anon', 'deny', 'อ่าน users', () => sel(A.client.from('users').select('user_id, email').limit(1))],
    ['P1-36', 'outsider', 'deny', 'อ่านอีเมลของสมาชิกกลุ่มนี้', () => sel(O.client.from('users').select('user_id, email').eq('user_id', M.user.id))],
    ['P1-37', 'anon', 'deny', 'join_group_by_code', () => rpcData(A.client.rpc('join_group_by_code', { p_code: joinCode }))],
    ['P1-38', 'anon', 'deny', 'log_activity ของกลุ่มนี้', logVia(A, 'P1-38')],
    ['P1-39', 'outsider', 'deny', 'log_activity ของกลุ่มนี้', logVia(O, 'P1-39')],
    ['P1-40', 'removed', 'deny', 'log_activity หลังถูกนำออก', logVia(R, 'P1-40')],
    ['P1-41', 'outsider', 'deny', 'verify_activity_chain ของกลุ่มนี้', () => rpcData(O.client.rpc('verify_activity_chain', { p_group_id: gid }))],
    ['P1-42', 'anon', 'deny', 'find_user_by_email', () => rpcData(A.client.rpc('find_user_by_email', { p_email: M.email }))],
    ['P1-43', 'outsider', 'deny', 'find_user_by_email (ไม่ได้เป็นหัวหน้ากลุ่มใด)', () => rpcData(O.client.rpc('find_user_by_email', { p_email: M.email }))],
    ['P1-44', 'anon', 'deny', 'อ่าน activity_heads', () => sel(A.client.from('activity_heads').select('group_id').limit(1))],
    ['P1-45', 'outsider', 'deny', 'อ่าน activity_heads', () => sel(O.client.from('activity_heads').select('group_id').limit(1))],

    // หลักที่ 2 สิทธิ์ตามบทบาท
    ['P2-01', 'member', 'deny', 'สร้างงาน', () => taskInsert(M, 'P2-01')],
    ['P2-02a', 'member', 'deny', 'แก้ priority งานของตัวเอง', () => state(M.client.from('tasks').update({ priority: 'urgent', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'priority')) === 'urgent')],
    ['P2-02b', 'member', 'deny', 'แก้ deadline งานของตัวเอง', () => state(M.client.from('tasks').update({ deadline: '2030-01-01T00:00:00Z', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => String(await taskField(T1, 'deadline')).startsWith('2030'))],
    ['P2-02c', 'member', 'deny', 'แก้ difficulty งานของตัวเอง', () => state(M.client.from('tasks').update({ difficulty: 'hard', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'difficulty')) === 'hard')],
    ['P2-02d', 'member', 'deny', 'แก้ headcount งานของตัวเอง', () => state(M.client.from('tasks').update({ headcount: 5, updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'headcount')) === 5)],
    ['P2-03', 'member', 'deny', 'ลบงาน', () => state(M.client.from('tasks').delete().eq('task_id', TD.task_id), async () => !(await taskExists(TD)))],
    ['P2-04', 'member', 'deny', 'แก้คำอธิบายกลุ่ม', () => state(M.client.from('groups').update({ description: 'by-member' }).eq('group_id', gid), async () => (await groupField('description')) === 'by-member')],
    ['P2-05', 'member', 'deny', 'เลื่อนตัวเองเป็นหัวหน้า', () => state(M.client.from('group_members').update({ role: 'leader' }).eq('group_id', gid).eq('user_id', M.user.id), async () => (await roleOf(M)) === 'leader')],
    ['P2-06', 'member', 'deny', 'remove_group_member', () => state(M.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: M2.user.id }), async () => !(await isMember(M2)))],
    ['P2-07', 'member', 'deny', 'archive_group', () => state(M.client.rpc('archive_group', { p_group_id: gid }), async () => (await groupField('archived_at')) !== null)],
    ['P2-08', 'member', 'deny', 'ตั้ง archived_at เองโดยตรง', () => state(M.client.from('groups').update({ archived_at: nowIso() }).eq('group_id', gid), async () => (await groupField('archived_at')) !== null)],
    ['P2-09', 'member', 'deny', 'request_leader_transfer ให้ตัวเอง', () => state(M.client.rpc('request_leader_transfer', { p_group_id: gid, p_user_id: M.user.id }), async () => (await groupField('pending_leader_id')) === M.user.id)],
    ['P2-10', 'member2', 'deny', 'respond_leader_transfer ทั้งที่คำขอส่งถึง M', async () => {
      must(await L.client.rpc('request_leader_transfer', { p_group_id: gid, p_user_id: M.user.id }), 'L proposes M')
      const r = await state(M2.client.rpc('respond_leader_transfer', { p_group_id: gid, p_accept: true }), async () => (await roleOf(M2)) === 'leader')
      must(await L.client.rpc('request_leader_transfer', { p_group_id: gid, p_user_id: null }), 'L cancels')
      return r
    }],
    ['P2-11a', 'member', 'deny', 'เปิดรอบประเมิน', () => ok(M.client.from('eval_rounds').insert({ group_id: gid, title: 'by-member', created_by: M.user.id }))],
    ['P2-11b', 'member', 'deny', 'ปิดรอบประเมิน', () => state(M.client.from('eval_rounds').update({ status: 'closed', closed_at: nowIso() }).eq('round_id', ER.round_id), async () => (await L.client.from('eval_rounds').select('status').eq('round_id', ER.round_id).single()).data?.status === 'closed')],
    ['P2-12', 'member', 'deny', 'get_peer_eval_results', () => rpcData(M.client.rpc('get_peer_eval_results', { p_round_id: ER.round_id }))],
    ['P2-13', 'leader', 'deny', 'get_peer_eval_results ขณะรอบยังเปิด', () => rpcData(L.client.rpc('get_peer_eval_results', { p_round_id: ER.round_id }))],
    ['P2-14', 'leader', 'deny', 'อ่านแถวคะแนนดิบ peer_evaluations', () => sel(L.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id))],
    ['P2-15', 'member', 'deny', 'เชิญผู้ร่วมทำ', () => ok(M.client.from('task_collaborators').insert({ task_id: T2.task_id, group_id: gid, user_id: M2.user.id, status: 'pending' }))],
    ['P2-16', 'leader', 'deny', 'นำตัวเองออกด้วย remove_group_member', () => state(L.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: L.user.id }), async () => !(await isMember(L)))],
    ['P2-17', 'leader', 'deny', 'leave_group ทั้งที่ยังเป็นหัวหน้า', () => state(L.client.rpc('leave_group', { p_group_id: gid }), async () => !(await isMember(L)))],
    ['P2-20a', 'member2', 'deny', 'ผู้รับอ่านฟีดแบคที่ระบุชื่อผู้ส่ง', () => sel(M2.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],
    ['P2-20b', 'member', 'deny', 'สมาชิกอื่นอ่านฟีดแบค', () => sel(M.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],

    // หลักที่ 3 สวมรอย
    ['P3-01', 'member', 'deny', 'task_responses ในนาม M2', () => ok(M.client.from('task_responses').insert({ task_id: T4.task_id, user_id: M2.user.id, response: 'rejected' }))],
    ['P3-02', 'member', 'deny', 'task_comments ในนาม M2', () => ok(M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M2.user.id, kind: 'comment', body: 'P3-02' }))],
    ['P3-03', 'member', 'deny', 'peer_evaluations ในนาม M2', () => ok(M.client.from('peer_evaluations').insert(pe(M2, L)))],
    ['P3-04', 'member', 'deny', 'group_visits ของ M2', () => ok(M.client.from('group_visits').upsert({ user_id: M2.user.id, group_id: gid, last_seen_at: nowIso() }, { onConflict: 'user_id,group_id' }))],
    ['P3-05', 'member', 'deny', 'แก้ full_name ของ M2', () => state(M.client.from('users').update({ full_name: 'hacked' }).eq('user_id', M2.user.id), async () => (await M2.client.from('users').select('full_name').eq('user_id', M2.user.id).single()).data?.full_name === 'hacked')],
    ['P3-06', 'member', 'deny', 'แก้ email ของตัวเอง', () => state(M.client.from('users').update({ email: 'changed@gt-eval.test' }).eq('user_id', M.user.id), async () => (await M.client.from('users').select('email').eq('user_id', M.user.id).single()).data?.email === 'changed@gt-eval.test')],
    ['P3-07', 'member', 'deny', 'อัปโหลดรูปลงโฟลเดอร์ของ M2', () => ok(M.client.storage.from('avatars').upload(`${M2.user.id}/v4-${Date.now()}.png`, png()))],
    ['P3-08', 'member', 'deny', 'INSERT activity_logs ตรง ๆ', () => ok(M.client.from('activity_logs').insert({ group_id: gid, actor_id: M.user.id, action_type: 'comment_added', payload: {} }))],
    ['P3-09', 'outsider', 'deny', 'สร้างกลุ่มในนาม L', () => ok(O.client.from('groups').insert({ group_name: `${PREFIX} forged`, work_mode: 'mixed', join_code: code6(), created_by: L.user.id }))],
    ['P3-10a', 'leader', 'deny', 'อ่าน activity_heads ของกลุ่มตัวเอง', () => sel(L.client.from('activity_heads').select('seq').eq('group_id', gid))],
    ['P3-10b', 'leader', 'deny', 'แก้ activity_heads ของกลุ่มตัวเอง', () => ok(L.client.from('activity_heads').update({ seq: 1 }).eq('group_id', gid).select())],

    // หลักที่ 4 แก้ย้อนหลังไม่ได้
    ['P4-01', 'leader', 'deny', 'UPDATE activity_logs', () => state(L.client.from('activity_logs').update({ payload: { tampered: true } }).eq('log_id', logRow.log_id), async () => (await L.client.from('activity_logs').select('payload').eq('log_id', logRow.log_id).single()).data?.payload?.tampered === true)],
    ['P4-02', 'leader', 'deny', 'DELETE activity_logs', () => state(L.client.from('activity_logs').delete().eq('log_id', logRow.log_id), async () => !(await M.client.from('activity_logs').select('log_id').eq('log_id', logRow.log_id).maybeSingle()).data)],
    ['P4-03', 'member', 'deny', 'แก้ความเห็นของตัวเอง', () => state(M.client.from('task_comments').update({ body: 'edited' }).eq('comment_id', comment.comment_id), async () => (await L.client.from('task_comments').select('body').eq('comment_id', comment.comment_id).single()).data?.body === 'edited')],
    ['P4-04', 'member', 'deny', 'ลบความเห็นของตัวเอง', () => state(M.client.from('task_comments').delete().eq('comment_id', comment.comment_id), async () => !(await L.client.from('task_comments').select('comment_id').eq('comment_id', comment.comment_id).maybeSingle()).data)],
    ['P4-05', 'leader', 'deny', 'ลบความเห็นของสมาชิก', () => state(L.client.from('task_comments').delete().eq('comment_id', comment.comment_id), async () => !(await M.client.from('task_comments').select('comment_id').eq('comment_id', comment.comment_id).maybeSingle()).data)],
    ['P4-06', 'member', 'deny', 'แก้คะแนนประเมินที่ส่งแล้ว', () => state(M.client.from('peer_evaluations').update({ quality: 1 }).eq('evaluation_id', myPe.evaluation_id), async () => (await M.client.from('peer_evaluations').select('quality').eq('evaluation_id', myPe.evaluation_id).single()).data?.quality === 1)],
    ['P4-07', 'member', 'deny', 'ลบคะแนนประเมินที่ส่งแล้ว', () => state(M.client.from('peer_evaluations').delete().eq('evaluation_id', myPe.evaluation_id), async () => !(await M.client.from('peer_evaluations').select('evaluation_id').eq('evaluation_id', myPe.evaluation_id).maybeSingle()).data)],
    ['P4-08', 'collab', 'deny', 'แก้คะแนนฟีดแบคที่ส่งแล้ว', () => state(C.client.from('task_feedback').update({ score: 1 }).eq('feedback_id', feedback.feedback_id), async () => (await L.client.from('task_feedback').select('score').eq('feedback_id', feedback.feedback_id).single()).data?.score === 1)],
    ['P4-09', 'collab', 'deny', 'ลบฟีดแบคที่ส่งแล้ว', () => state(C.client.from('task_feedback').delete().eq('feedback_id', feedback.feedback_id), async () => !(await L.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id).maybeSingle()).data)],

    // หลักที่ 5 กติกาของงาน
    ['P5-01', 'member', 'deny', 'โอนงานของตัวเองให้ M2', () => state(M.client.from('tasks').update({ assigned_to: M2.user.id, updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'assigned_to')) === M2.user.id)],
    ['P5-02', 'member', 'deny', 'claim งานที่มีคนหลักแล้ว', () => state(M.client.from('tasks').update({ assigned_to: M.user.id, updated_at: nowIso() }).eq('task_id', T4.task_id), async () => (await taskField(T4, 'assigned_to')) === M.user.id)],
    ['P5-03', 'collab', 'deny', 'ผู้ร่วมทำกดงานเสร็จ', () => state(C.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'completed')],
    ['P5-04', 'leader', 'deny', 'เชิญผู้ร่วมทำเกิน headcount − 1', () => ok(L.client.from('task_collaborators').insert({ task_id: T1.task_id, group_id: gid, user_id: M2.user.id, status: 'pending' }))],
    ['P5-05', 'leader', 'deny', 'เชิญคนนอกกลุ่มเป็นผู้ร่วมทำ', () => ok(L.client.from('task_collaborators').insert({ task_id: T4.task_id, group_id: gid, user_id: O.user.id, status: 'pending' }))],
    ['P5-06', 'leader', 'deny', 'แก้ deadline งานที่ยังไม่เสร็จโดยไม่ใส่เหตุผล', () => state(L.client.from('tasks').update({ deadline: '2030-02-02T00:00:00Z', updated_at: nowIso() }).eq('task_id', T4.task_id), async () => String(await taskField(T4, 'deadline')).startsWith('2030-02-02'))],
    ['P5-07', 'leader', 'deny', 'เปลี่ยน assigned_to งานที่ยังไม่เสร็จโดยไม่ใส่เหตุผล', () => state(L.client.from('tasks').update({ assigned_to: M.user.id, updated_at: nowIso() }).eq('task_id', T4.task_id), async () => (await taskField(T4, 'assigned_to')) === M.user.id)],
    ['P5-08', 'member', 'deny', 'ส่งฟีดแบคงานที่ไม่ได้ร่วมทำ', () => ok(M.client.from('task_feedback').insert({ task_id: T3.task_id, group_id: gid, from_user: M.user.id, to_user: M2.user.id, score: 1 }))],
    ['P5-09', 'member', 'deny', 'อัปโหลดรูปเกิน 2 MB', async () => {
      const res = await M.client.storage.from('avatars').upload(`${M.user.id}/v4-big-${Date.now()}.png`, png(2.1 * 1024 * 1024))
      if (res.data?.path) await M.client.storage.from('avatars').remove([res.data.path])
      return { allowed: !res.error, detail: res.error?.message ?? 'uploaded' }
    }],
    ['P5-10', 'member', 'deny', 'ส่ง status ที่ฐานข้อมูลไม่รับ', () => state(M.client.from('tasks').update({ status: 'done', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'done')],

    // หลักที่ 6 token ปลอม
    ['P6-01', 'forged', 'deny', 'token ของ M ที่แก้ sub เป็น L', () => {
      const [h, , s] = mToken.split('.')
      const forged = [h, Buffer.from(JSON.stringify({ ...jwtPayload(mToken), sub: L.user.id })).toString('base64url'), s].join('.')
      return rest(forged, `groups?select=group_id&group_id=eq.${gid}`)
    }],
    ['P6-02', 'expired', 'deny', 'token ที่หมดอายุแล้ว', () => expired
      ? rest(expired, `tasks?select=task_id&group_id=in.(${[...mGroups].join(',')})`)
      : { allowed: true, detail: 'ไม่มี token หมดอายุจากการรันครั้งก่อน (ทดสอบไม่ได้ นับว่าไม่ผ่าน)' }],
    ['P6-03', 'removed', 'deny', 'token ของ R ที่ออกก่อนถูกนำออก', async () => rest(await tokenOf(R), `tasks?select=task_id&group_id=eq.${gid}`)],

    // หลักที่ 7 injection
    ['P7-01', 'member', 'safe', 'ความเห็นที่มี SQL', async () => {
      const body = "'; drop table tasks; --"
      const before = (await L.client.from('tasks').select('task_id', { count: 'exact', head: true }).eq('group_id', gid)).count
      const { data, error } = await M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M.user.id, kind: 'comment', body }).select('body').single()
      const after = (await L.client.from('tasks').select('task_id', { count: 'exact', head: true }).eq('group_id', gid)).count
      return { allowed: !error && data?.body === body && before === after, detail: error?.message ?? `stored=${data?.body === body} tasks ${before}->${after}` }
    }],
    ['P7-02', 'outsider', 'safe', "join_group_by_code ด้วย ' OR '1'='1", async () => {
      const count = async () => (await O.client.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', O.user.id)).count
      const before = await count()
      const { data, error } = await O.client.rpc('join_group_by_code', { p_code: "' OR '1'='1" })
      const after = await count()
      const joined = Array.isArray(data) ? data.length > 0 && data[0]?.joined_group_id : !!data?.joined_group_id
      return { allowed: !joined && before === after, detail: error?.message ?? `data=${JSON.stringify(data)} memberships ${before}->${after}` }
    }],
    ['P7-03', 'leader', 'safe', "find_user_by_email ด้วย % และ ' or 1=1 --", async () => {
      const out = []
      for (const p of ['%', "' or 1=1 --"]) {
        const { data, error } = await L.client.rpc('find_user_by_email', { p_email: p })
        out.push({ p, n: Array.isArray(data) ? data.length : data ? 1 : 0, error: error?.message })
      }
      return { allowed: out.every((o) => o.n === 0), detail: JSON.stringify(out) }
    }],
    ['P7-04', 'member', 'safe', 'ตัวกรอง or=(group_id.neq.<กลุ่มนี้>)', async () => {
      const { data, error } = await M.client.from('tasks').select('task_id, group_id').or(`group_id.neq.${gid}`).limit(1000)
      const leaked = (data || []).filter((t) => !mGroups.has(t.group_id))
      return { allowed: !!error || leaked.length === 0, detail: error?.message ?? `${data.length} rows, นอกกลุ่มของ M ${leaked.length}` }
    }],
    ['P7-05', 'member', 'safe', 'ชื่องานที่ฝัง <img onerror> แสดงเป็นข้อความ', async () => {
      const title = '<img src=x onerror="window.__gtXss=1">'
      must(await L.client.from('tasks').insert({ group_id: gid, title, priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: L.user.id, updated_at: nowIso() }), 'xss task')
      const page = await pageAs('member')
      await page.goto(`${BASE_URL}/dashboard/groups/${gid}?tab=tasks`)
      await page.getByText('<img src=x', { exact: false }).first().waitFor({ timeout: 30000 })
      await page.waitForTimeout(1500)
      const fired = await page.evaluate(() => window.__gtXss === 1)
      await closeBrowser()
      return { allowed: !fired, detail: `แสดงเป็นข้อความ, สคริปต์ทำงาน=${fired}` }
    }],

    // หลักที่ 8 ต้องทำได้
    ['P8-01', 'member', 'allow', 'อ่านงานและประวัติของกลุ่ม', async () => {
      const t = await sel(M.client.from('tasks').select('task_id').eq('group_id', gid))
      const l = await sel(M.client.from('activity_logs').select('log_id').eq('group_id', gid))
      return { allowed: t.allowed && l.allowed, detail: `tasks ${t.detail}, logs ${l.detail}` }
    }],
    ['P8-02', 'leader', 'allow', 'สร้างงาน', () => taskInsert(L, 'P8-02')],
    ['P8-03', 'member', 'allow', 'เปลี่ยนสถานะงานของตัวเองเป็น in_progress', () => state(M.client.from('tasks').update({ status: 'in_progress', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'in_progress')],
    ['P8-04', 'member', 'allow', 'claim งานว่างให้ตัวเอง', () => state(M.client.from('tasks').update({ assigned_to: M.user.id, status: 'accepted', updated_at: nowIso() }).eq('task_id', T2.task_id), async () => (await taskField(T2, 'assigned_to')) === M.user.id)],
    ['P8-06', 'collab', 'allow', 'แก้คำอธิบายงานที่ร่วมทำ', () => state(C.client.from('tasks').update({ description: 'by-collab', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'description')) === 'by-collab')],
    ['P8-07', 'member', 'allow', 'บันทึกกิจกรรมผ่าน log_activity', logVia(M, 'P8-07')],
    ['P8-08', 'member', 'allow', 'เขียนความเห็น', () => ok(M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M.user.id, kind: 'decision', body: 'P8-08' }))],
    ['P8-09', 'member', 'allow', 'แก้ชื่อที่แสดงของตัวเอง', () => state(M.client.from('users').update({ full_name: 'ผู้ทดสอบ สมาชิก' }).eq('user_id', M.user.id), async () => (await M.client.from('users').select('full_name').eq('user_id', M.user.id).single()).data?.full_name === 'ผู้ทดสอบ สมาชิก')],
    ['P8-10', 'member', 'allow', 'อัปโหลดรูปลงโฟลเดอร์ตัวเอง', async () => {
      const res = await M.client.storage.from('avatars').upload(`${M.user.id}/v4-${Date.now()}.png`, png())
      if (res.data?.path) await M.client.storage.from('avatars').remove([res.data.path])
      return { allowed: !res.error, detail: res.error?.message ?? 'no error' }
    }],
    ['P8-11', 'leader', 'allow', 'แก้ deadline พร้อม change_reason', () => state(L.client.from('tasks').update({ deadline: '2030-03-03T00:00:00Z', change_reason: 'P8-11', updated_at: nowIso() }).eq('task_id', T4.task_id), async () => String(await taskField(T4, 'deadline')).startsWith('2030-03-03'))],
    ['P8-13', 'member', 'allow', 'อ่านงานของกลุ่มที่เก็บเข้าคลังแล้ว', () => sel(M.client.from('tasks').select('task_id').eq('task_id', TA.task_id))],
    ['P8-14', 'member', 'allow', 'อ่านอีเมลของ M2 (กลุ่มเดียวกัน)', async () => {
      const { data, error } = await M.client.from('users').select('email').eq('user_id', M2.user.id).maybeSingle()
      return { allowed: !error && data?.email === M2.email, detail: error?.message ?? `email=${data?.email}` }
    }],
    ['P8-05', 'member', 'allow', 'คนหลักกดงานเสร็จ', () => state(M.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'completed')],
    ['P8-12', 'leader', 'allow', 'ลบงาน', () => state(L.client.from('tasks').delete().eq('task_id', TD.task_id), async () => !(await taskExists(TD)))],

    // หลักที่ 2 ที่เปลี่ยนข้อมูลมาก (ท้ายสุด)
    ['P2-18', 'leader', 'deny', 'ลบแถว group_members ตรง ๆ', () => state(L.client.from('group_members').delete().eq('group_id', gid).eq('user_id', M2.user.id), async () => !(await isMember(M2)))],
    ['P2-19', 'leader', 'deny', 'ลบแถว groups จริง', async () => {
      const g2 = await createGroup(L, `${PREFIX} delete ${label}`)
      const { error } = await L.client.from('groups').delete().eq('group_id', g2.group_id)
      const gone = !(await L.client.from('groups').select('group_id').eq('group_id', g2.group_id).maybeSingle()).data
      if (!gone) await L.client.rpc('archive_group', { p_group_id: g2.group_id })
      return { allowed: gone, detail: error?.message ?? (gone ? 'deleted' : 'still exists') }
    }],
  ]

  // ---------- รัน ----------
  const results = []
  for (const [id, role, expect, desc, fn] of cases) {
    // exception = สคริปต์หรือ fixture ล้ม ไม่ใช่การปฏิเสธจากระบบ จึงนับว่าไม่ผ่าน
    let r
    try { r = await fn() } catch (e) { r = { error: true, detail: `exception: ${e.message}` } }
    const actual = r.error ? 'error' : expect === 'safe' ? (r.allowed ? 'safe' : 'unsafe') : r.allowed ? 'allow' : 'deny'
    const pass = actual === expect && !(id === 'P6-02' && !expired)
    results.push({ id, role, desc, expect, actual, pass, detail: r.detail })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(7)} ${role.padEnd(8)} expect=${expect} actual=${actual}  ${desc}  [${r.detail}]`)
  }
  await L.client.rpc('archive_group', { p_group_id: gid })

  const passed = results.filter((r) => r.pass).length
  console.log(`\nKPI-4 (การเข้าถึง) ${label}: ${passed}/${results.length} ตรงกับที่คาด`)
  if (pilot) return
  writeResult(`v4-kpi4-round${round}-run${run}.json`, { kpi: 'KPI-4', part: 'access', round, run, group_id: gid, archived_group_id: GA.group_id, expiredTokenIssuedAt: expired ? new Date(jwtPayload(expired).iat * 1000).toISOString() : null, passed, total: results.length, pass: passed === results.length, results })
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
