// KPI-9 ทดสอบสิทธิ์ตามบทบาท: เรียก API ของ Supabase ตรง ๆ ด้วยการล็อกอินจริงของแต่ละบทบาท
// ผลที่คาด (expect) ของทุกกรณีถูก commit ก่อนรันครั้งแรก อ้างอิงกติกาใน CLAUDE.md และไฟล์ supabase-*.sql
// allow = ต้องทำได้, deny = ต้องทำไม่ได้ (error หรือไม่มีผลต่อข้อมูล)
//
// วิธีรัน: node kpi9-rls.mjs <round> <run>   เช่น node kpi9-rls.mjs 1 1
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, newClient, nowIso, ROOT } from './lib.mjs'

const [round = '1', run = '1'] = process.argv.slice(2)
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')

function must(res, what) {
  if (res.error) throw new Error(`fixture: ${what}: ${res.error.message}`)
  return res.data
}

// ---------- ตัวช่วยตัดสินผล ----------
// SELECT: ทำได้เมื่อไม่มี error และได้แถวกลับมา
async function sel(q) {
  const { data, error } = await q
  return { allowed: !error && Array.isArray(data) && data.length > 0, detail: error?.message ?? `${data?.length ?? 0} rows` }
}
// INSERT / RPC ที่ไม่คืนข้อมูล: ทำได้เมื่อไม่มี error
async function ok(q) {
  const { error } = await q
  return { allowed: !error, detail: error?.message ?? 'no error' }
}
// RPC ที่คืนข้อมูล: ทำได้เมื่อไม่มี error และได้ข้อมูลที่ไม่ว่าง
async function rpcData(q) {
  const { data, error } = await q
  const empty = data === null || data === undefined || (Array.isArray(data) && data.length === 0)
  return { allowed: !error && !empty, detail: error?.message ?? JSON.stringify(data)?.slice(0, 80) }
}
// UPDATE/DELETE/RPC ที่เปลี่ยนสถานะ: ตัดสินจากสถานะจริงที่อ่านด้วยบัญชีผู้ตรวจ
async function state(q, check) {
  const { error } = await q
  const changed = await check()
  return { allowed: changed, detail: error?.message ?? (changed ? 'changed' : 'unchanged') }
}

async function main() {
  // ---------- บัญชี ----------
  const L = await signInAs('leader', 'ผู้ทดสอบ หัวหน้า')
  const M = await signInAs('member', 'ผู้ทดสอบ สมาชิก')
  const M2 = await signInAs('member2', 'ผู้ทดสอบ สมาชิกสอง')
  const C = await signInAs('collab', 'ผู้ทดสอบ ผู้ร่วมทำ')
  const O = await signInAs('outsider', 'ผู้ทดสอบ คนนอก')
  const R = await signInAs('removed', 'ผู้ทดสอบ ถูกนำออก')
  const A = { client: newClient() } // anonymous key

  // ---------- fixture: สร้างกลุ่มและข้อมูลแบบเดียวกับที่หน้าเว็บทำ ----------
  const joinCode = code6()
  const G = must(await L.client.from('groups').insert({
    group_name: `[TEST] KPI-9 r${round} run${run}`, description: 'kpi9', work_mode: 'mixed', join_code: joinCode, created_by: L.user.id,
  }).select().single(), 'create group')
  const gid = G.group_id
  must(await L.client.from('group_members').insert({ group_id: gid, user_id: L.user.id, role: 'leader' }), 'leader membership')
  must(await L.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'group_created', p_entity_type: 'group', p_entity_id: gid, p_payload: { group_name: G.group_name, work_mode: 'mixed' } }), 'log group_created')
  for (const u of [M, M2, C, R]) must(await u.client.rpc('join_group_by_code', { p_code: joinCode }), `join ${u.role}`)

  const mkTask = async (title, extra) => must(await L.client.from('tasks').insert({
    group_id: gid, title, priority: 'medium', difficulty: 'medium', headcount: 2, assigned_by: L.user.id, updated_at: nowIso(),
    status: 'assigned', assignment_type: 'leader_assign', ...extra,
  }).select().single(), `task ${title}`)
  const T1 = await mkTask('T1 ของสมาชิก', { assigned_to: M.user.id })
  const T2 = await mkTask('T2 งานว่าง', { assigned_to: null, status: 'pending', assignment_type: 'open_choice' })
  const T3 = await mkTask('T3 ของสมาชิกสอง', { assigned_to: M2.user.id })
  const T4 = await mkTask('T4 หลายคน', { assigned_to: M2.user.id, headcount: 3 })
  const TD = await mkTask('TD สำหรับทดสอบลบ', { assigned_to: M.user.id })

  // C เป็นผู้ร่วมทำที่รับแล้วของ T1 และ T3
  for (const t of [T1, T3]) {
    must(await L.client.from('task_collaborators').insert({ task_id: t.task_id, group_id: gid, user_id: C.user.id, status: 'pending' }), 'invite C')
    must(await C.client.from('task_collaborators').update({ status: 'accepted', responded_at: nowIso() }).eq('task_id', t.task_id).eq('user_id', C.user.id), 'C accepts')
  }
  // T3 เสร็จโดยคนหลัก แล้ว C ส่งฟีดแบคให้ M2
  must(await M2.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T3.task_id), 'complete T3')
  must(await C.client.from('task_feedback').insert({ task_id: T3.task_id, group_id: gid, from_user: C.user.id, to_user: M2.user.id, score: 4, comment: 'fixture' }), 'feedback')
  // ความเห็นและ log
  must(await M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M.user.id, kind: 'comment', body: 'fixture comment' }), 'comment')
  must(await M.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: T1.title, preview: 'fixture comment' } }), 'log comment')
  // รอบประเมินเพื่อน
  const ER = must(await L.client.from('eval_rounds').insert({ group_id: gid, title: 'รอบทดสอบ', created_by: L.user.id }).select().single(), 'eval round')
  const pe = (from, to) => ({ round_id: ER.round_id, group_id: gid, evaluator_id: from.user.id, evaluatee_id: to.user.id, responsibility: 4, quality: 4, teamwork: 4, comment: 'fixture' })
  must(await M.client.from('peer_evaluations').insert(pe(M, M2)), 'pe M->M2')
  must(await M2.client.from('peer_evaluations').insert(pe(M2, M)), 'pe M2->M')
  must(await M.client.from('group_visits').upsert({ user_id: M.user.id, group_id: gid, last_seen_at: nowIso() }, { onConflict: 'user_id,group_id' }), 'visit')
  // R ถูกหัวหน้านำออก
  must(await L.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: R.user.id }), 'remove R')

  const comment = must(await M.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id).single(), 'read comment')
  const logRow = must(await L.client.from('activity_logs').select('*').eq('group_id', gid).limit(1).single(), 'read log')
  const logKey = 'log_id' in logRow ? 'log_id' : 'id'
  const feedback = must(await C.client.from('task_feedback').select('feedback_id').eq('task_id', T3.task_id).single(), 'read feedback')
  const myPe = must(await M.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id).single(), 'read pe')

  // ตัวอ่านสถานะจริง
  const taskField = async (t, col) => (await L.client.from('tasks').select(col).eq('task_id', t.task_id).single()).data?.[col]
  const taskExists = async (t) => !!(await L.client.from('tasks').select('task_id').eq('task_id', t.task_id).maybeSingle()).data
  const isMember = async (u) => !!(await L.client.from('group_members').select('user_id').eq('group_id', gid).eq('user_id', u.user.id).maybeSingle()).data
  const roleOf = async (u) => (await L.client.from('group_members').select('role').eq('group_id', gid).eq('user_id', u.user.id).maybeSingle()).data?.role
  const groupField = async (col) => (await L.client.from('groups').select(col).eq('group_id', gid).single()).data?.[col]
  const logCount = async () => (await L.client.from('activity_logs').select(logKey, { count: 'exact', head: true }).eq('group_id', gid)).count

  // ---------- กรณีทดสอบ (รันตามลำดับ) ----------
  const cases = [
    // groups
    ['G-01', 'leader', 'allow', 'อ่านกลุ่มของตัวเอง', () => sel(L.client.from('groups').select('group_id').eq('group_id', gid))],
    ['G-02', 'member', 'allow', 'อ่านกลุ่มที่เป็นสมาชิก', () => sel(M.client.from('groups').select('group_id').eq('group_id', gid))],
    ['G-03', 'outsider', 'deny', 'อ่านกลุ่มที่ไม่ได้เป็นสมาชิก', () => sel(O.client.from('groups').select('group_id').eq('group_id', gid))],
    ['G-04', 'removed', 'deny', 'อ่านกลุ่มหลังถูกนำออก', () => sel(R.client.from('groups').select('group_id').eq('group_id', gid))],
    ['G-05', 'anon', 'deny', 'อ่านกลุ่มโดยไม่ล็อกอิน', () => sel(A.client.from('groups').select('group_id').eq('group_id', gid))],
    ['G-06', 'leader', 'allow', 'แก้คำอธิบายกลุ่ม', () => state(L.client.from('groups').update({ description: 'by-leader' }).eq('group_id', gid), async () => (await groupField('description')) === 'by-leader')],
    ['G-07', 'member', 'deny', 'แก้คำอธิบายกลุ่ม', () => state(M.client.from('groups').update({ description: 'by-member' }).eq('group_id', gid), async () => (await groupField('description')) === 'by-member')],
    ['G-08', 'outsider', 'deny', 'แก้คำอธิบายกลุ่ม', () => state(O.client.from('groups').update({ description: 'by-outsider' }).eq('group_id', gid), async () => (await groupField('description')) === 'by-outsider')],
    ['G-09', 'member', 'deny', 'เก็บกลุ่มเข้าคลังเองโดยตรง', () => state(M.client.from('groups').update({ archived_at: nowIso() }).eq('group_id', gid), async () => (await groupField('archived_at')) !== null)],
    ['G-10', 'outsider', 'deny', 'สร้างกลุ่มในนามคนอื่น', () => ok(O.client.from('groups').insert({ group_name: '[TEST] forged', work_mode: 'mixed', join_code: code6(), created_by: L.user.id }))],

    // group_members
    ['GM-01', 'member', 'allow', 'อ่านรายชื่อสมาชิกในกลุ่ม', () => sel(M.client.from('group_members').select('user_id').eq('group_id', gid).neq('user_id', M.user.id))],
    ['GM-02', 'outsider', 'deny', 'อ่านรายชื่อสมาชิก', () => sel(O.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['GM-03', 'removed', 'deny', 'อ่านรายชื่อสมาชิกหลังถูกนำออก', () => sel(R.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['GM-04', 'anon', 'deny', 'อ่านรายชื่อสมาชิก', () => sel(A.client.from('group_members').select('user_id').eq('group_id', gid))],
    ['GM-05', 'outsider', 'deny', 'เพิ่มตัวเองเข้ากลุ่มโดยตรง', () => ok(O.client.from('group_members').insert({ group_id: gid, user_id: O.user.id, role: 'member' }))],
    ['GM-06', 'removed', 'deny', 'เพิ่มตัวเองกลับเข้ากลุ่มโดยตรง', () => ok(R.client.from('group_members').insert({ group_id: gid, user_id: R.user.id, role: 'member' }))],
    ['GM-07', 'member', 'deny', 'เลื่อนตัวเองเป็นหัวหน้า', () => state(M.client.from('group_members').update({ role: 'leader' }).eq('group_id', gid).eq('user_id', M.user.id), async () => (await roleOf(M)) === 'leader')],
    ['GM-08', 'member', 'deny', 'เพิ่มคนนอกเข้ากลุ่ม', () => ok(M.client.from('group_members').insert({ group_id: gid, user_id: O.user.id, role: 'member' }))],
    ['GM-09', 'member', 'deny', 'ลบหัวหน้าออกจากกลุ่มโดยตรง', () => state(M.client.from('group_members').delete().eq('group_id', gid).eq('user_id', L.user.id), async () => !(await isMember(L)))],
    ['GM-10', 'anon', 'deny', 'เข้ากลุ่มด้วยรหัสโดยไม่ล็อกอิน', () => rpcData(A.client.rpc('join_group_by_code', { p_code: joinCode }))],

    // tasks
    ['T-01', 'member', 'allow', 'อ่านงานในกลุ่ม', () => sel(M.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['T-02', 'outsider', 'deny', 'อ่านงานในกลุ่ม', () => sel(O.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['T-03', 'removed', 'deny', 'อ่านงานหลังถูกนำออก', () => sel(R.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['T-04', 'anon', 'deny', 'อ่านงาน', () => sel(A.client.from('tasks').select('task_id').eq('group_id', gid))],
    ['T-05', 'leader', 'allow', 'สร้างงาน', () => ok(L.client.from('tasks').insert({ group_id: gid, title: 'T-05', priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: L.user.id, updated_at: nowIso() }))],
    ['T-06', 'member', 'deny', 'สร้างงาน (หัวหน้าเท่านั้น)', () => ok(M.client.from('tasks').insert({ group_id: gid, title: 'T-06', priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: M.user.id, updated_at: nowIso() }))],
    ['T-07', 'outsider', 'deny', 'สร้างงาน', () => ok(O.client.from('tasks').insert({ group_id: gid, title: 'T-07', priority: 'low', status: 'pending', assignment_type: 'open_choice', assigned_by: O.user.id, updated_at: nowIso() }))],
    ['T-08', 'member', 'allow', 'เปลี่ยนสถานะงานของตัวเองเป็น in_progress', () => state(M.client.from('tasks').update({ status: 'in_progress', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'in_progress')],
    ['T-09', 'member', 'deny', 'แก้ priority งานของตัวเอง', () => state(M.client.from('tasks').update({ priority: 'urgent', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'priority')) === 'urgent')],
    ['T-10', 'member', 'deny', 'แก้ deadline งานของตัวเอง', () => state(M.client.from('tasks').update({ deadline: '2030-01-01T00:00:00Z', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => String(await taskField(T1, 'deadline')).startsWith('2030'))],
    ['T-11', 'member', 'deny', 'แก้ difficulty งานของตัวเอง', () => state(M.client.from('tasks').update({ difficulty: 'hard', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'difficulty')) === 'hard')],
    ['T-12', 'member', 'deny', 'แก้ headcount งานของตัวเอง', () => state(M.client.from('tasks').update({ headcount: 5, updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'headcount')) === 5)],
    ['T-13', 'member', 'deny', 'โอนงานของตัวเองให้คนอื่น', () => state(M.client.from('tasks').update({ assigned_to: M2.user.id, updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'assigned_to')) === M2.user.id)],
    ['T-14', 'member', 'deny', 'แก้งานของคนอื่น', () => state(M.client.from('tasks').update({ title: 'hacked', updated_at: nowIso() }).eq('task_id', T4.task_id), async () => (await taskField(T4, 'title')) === 'hacked')],
    ['T-15', 'member', 'deny', 'แย่งงานที่มีคนหลักแล้ว', () => state(M.client.from('tasks').update({ assigned_to: M.user.id, updated_at: nowIso() }).eq('task_id', T4.task_id), async () => (await taskField(T4, 'assigned_to')) === M.user.id)],
    ['T-16', 'collab', 'allow', 'ผู้ร่วมทำแก้คำอธิบายงาน', () => state(C.client.from('tasks').update({ description: 'by-collab', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'description')) === 'by-collab')],
    ['T-17', 'collab', 'deny', 'ผู้ร่วมทำกดงานเสร็จ', () => state(C.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'completed')],
    ['T-18', 'outsider', 'deny', 'แก้งาน', () => state(O.client.from('tasks').update({ title: 'by-outsider', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'title')) === 'by-outsider')],
    ['T-19', 'removed', 'deny', 'แก้งานหลังถูกนำออก', () => state(R.client.from('tasks').update({ title: 'by-removed', updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'title')) === 'by-removed')],
    ['T-20', 'member', 'deny', 'ลบงาน', () => state(M.client.from('tasks').delete().eq('task_id', TD.task_id), async () => !(await taskExists(TD)))],

    // task_collaborators
    ['TC-01', 'member', 'deny', 'เชิญผู้ร่วมทำ (หัวหน้าเท่านั้น)', () => ok(M.client.from('task_collaborators').insert({ task_id: T2.task_id, group_id: gid, user_id: M2.user.id, status: 'pending' }))],
    ['TC-02', 'outsider', 'deny', 'เข้าร่วมงานว่างเอง', () => ok(O.client.from('task_collaborators').insert({ task_id: T2.task_id, group_id: gid, user_id: O.user.id, status: 'accepted' }))],
    ['TC-03', 'leader', 'deny', 'เชิญคนนอกกลุ่มเป็นผู้ร่วมทำ', () => ok(L.client.from('task_collaborators').insert({ task_id: T4.task_id, group_id: gid, user_id: O.user.id, status: 'pending' }))],
    ['TC-04', 'member', 'deny', 'เปลี่ยนสถานะผู้ร่วมทำของคนอื่น', () => state(M.client.from('task_collaborators').update({ status: 'rejected' }).eq('task_id', T1.task_id).eq('user_id', C.user.id), async () => (await L.client.from('task_collaborators').select('status').eq('task_id', T1.task_id).eq('user_id', C.user.id).single()).data?.status === 'rejected')],
    ['TC-05', 'outsider', 'deny', 'อ่านรายชื่อผู้ร่วมทำ', () => sel(O.client.from('task_collaborators').select('user_id').eq('group_id', gid))],
    ['TC-06', 'member2', 'allow', 'เข้าร่วมงานว่างเอง', () => ok(M2.client.from('task_collaborators').insert({ task_id: T2.task_id, group_id: gid, user_id: M2.user.id, status: 'accepted' }))],
    ['TC-07', 'member', 'allow', 'claim งานว่างให้ตัวเอง', () => state(M.client.from('tasks').update({ assigned_to: M.user.id, status: 'accepted', updated_at: nowIso() }).eq('task_id', T2.task_id), async () => (await taskField(T2, 'assigned_to')) === M.user.id)],

    // task_responses
    ['TR-01', 'member', 'allow', 'บันทึกการรับงานของตัวเอง', () => ok(M.client.from('task_responses').insert({ task_id: T1.task_id, user_id: M.user.id, response: 'accepted' }))],
    ['TR-02', 'outsider', 'deny', 'บันทึกการรับงาน', () => ok(O.client.from('task_responses').insert({ task_id: T1.task_id, user_id: O.user.id, response: 'accepted' }))],
    ['TR-03', 'member', 'deny', 'บันทึกการรับงานในนามคนอื่น', () => ok(M.client.from('task_responses').insert({ task_id: T4.task_id, user_id: M2.user.id, response: 'rejected' }))],
    ['TR-04', 'outsider', 'deny', 'อ่านการตอบรับงาน', () => sel(O.client.from('task_responses').select('*').eq('task_id', T1.task_id))],

    // task_comments
    ['CM-01', 'member', 'allow', 'เขียนความเห็นในงาน', () => ok(M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M.user.id, kind: 'decision', body: 'CM-01' }))],
    ['CM-02', 'outsider', 'deny', 'เขียนความเห็น', () => ok(O.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: O.user.id, kind: 'comment', body: 'CM-02' }))],
    ['CM-03', 'member', 'deny', 'เขียนความเห็นในนามคนอื่น', () => ok(M.client.from('task_comments').insert({ group_id: gid, task_id: T1.task_id, author_id: M2.user.id, kind: 'comment', body: 'CM-03' }))],
    ['CM-04', 'outsider', 'deny', 'อ่านความเห็น', () => sel(O.client.from('task_comments').select('comment_id').eq('task_id', T1.task_id))],
    ['CM-05', 'member', 'deny', 'แก้ความเห็นของตัวเองย้อนหลัง', () => state(M.client.from('task_comments').update({ body: 'edited' }).eq('comment_id', comment.comment_id), async () => (await L.client.from('task_comments').select('body').eq('comment_id', comment.comment_id).single()).data?.body === 'edited')],
    ['CM-06', 'member', 'deny', 'ลบความเห็นของตัวเอง', () => state(M.client.from('task_comments').delete().eq('comment_id', comment.comment_id), async () => !(await L.client.from('task_comments').select('comment_id').eq('comment_id', comment.comment_id).maybeSingle()).data)],
    ['CM-07', 'leader', 'deny', 'ลบความเห็นของสมาชิก', () => state(L.client.from('task_comments').delete().eq('comment_id', comment.comment_id), async () => !(await M.client.from('task_comments').select('comment_id').eq('comment_id', comment.comment_id).maybeSingle()).data)],

    // activity_logs
    ['AL-01', 'member', 'allow', 'อ่านประวัติกิจกรรมของกลุ่ม', () => sel(M.client.from('activity_logs').select('*').eq('group_id', gid))],
    ['AL-02', 'outsider', 'deny', 'อ่านประวัติกิจกรรม', () => sel(O.client.from('activity_logs').select('*').eq('group_id', gid))],
    ['AL-03', 'removed', 'deny', 'อ่านประวัติกิจกรรมหลังถูกนำออก', () => sel(R.client.from('activity_logs').select('*').eq('group_id', gid))],
    ['AL-04', 'anon', 'deny', 'อ่านประวัติกิจกรรม', () => sel(A.client.from('activity_logs').select('*').eq('group_id', gid))],
    ['AL-05', 'member', 'deny', 'เขียนลง activity_logs โดยตรง', () => ok(M.client.from('activity_logs').insert({ group_id: gid, actor_id: M.user.id, action_type: 'comment_added', payload: {} }))],
    ['AL-06', 'leader', 'deny', 'แก้แถวประวัติกิจกรรม', () => state(L.client.from('activity_logs').update({ payload: { tampered: true } }).eq(logKey, logRow[logKey]), async () => (await L.client.from('activity_logs').select('payload').eq(logKey, logRow[logKey]).single()).data?.payload?.tampered === true)],
    ['AL-07', 'leader', 'deny', 'ลบแถวประวัติกิจกรรม', () => state(L.client.from('activity_logs').delete().eq(logKey, logRow[logKey]), async () => !(await M.client.from('activity_logs').select(logKey).eq(logKey, logRow[logKey]).maybeSingle()).data)],
    ['AL-08', 'member', 'allow', 'บันทึกกิจกรรมผ่าน log_activity', () => ok(M.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: T1.title, preview: 'AL-08' } }))],
    ['AL-09', 'outsider', 'deny', 'บันทึกกิจกรรมผ่าน log_activity', () => { return (async () => { const before = await logCount(); const r = await O.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: 'x', preview: 'AL-09' } }); const after = await logCount(); return { allowed: after > before, detail: r.error?.message ?? `count ${before}->${after}` } })() }],
    ['AL-10', 'removed', 'deny', 'บันทึกกิจกรรมหลังถูกนำออก', () => { return (async () => { const before = await logCount(); const r = await R.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: 'x', preview: 'AL-10' } }); const after = await logCount(); return { allowed: after > before, detail: r.error?.message ?? `count ${before}->${after}` } })() }],
    ['AL-11', 'anon', 'deny', 'บันทึกกิจกรรมผ่าน log_activity', () => { return (async () => { const before = await logCount(); const r = await A.client.rpc('log_activity', { p_group_id: gid, p_action_type: 'comment_added', p_entity_type: 'task', p_entity_id: T1.task_id, p_payload: { title: 'x', preview: 'AL-11' } }); const after = await logCount(); return { allowed: after > before, detail: r.error?.message ?? `count ${before}->${after}` } })() }],
    ['AL-12', 'outsider', 'deny', 'ตรวจสายบันทึกของกลุ่มอื่น', () => rpcData(O.client.rpc('verify_activity_chain', { p_group_id: gid }))],

    // task_feedback
    ['TF-01', 'collab', 'allow', 'ผู้ส่งอ่านฟีดแบคของตัวเอง', () => sel(C.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],
    ['TF-02', 'leader', 'allow', 'หัวหน้าอ่านฟีดแบค', () => sel(L.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],
    ['TF-03', 'member2', 'deny', 'ผู้รับอ่านฟีดแบคที่ระบุชื่อผู้ส่ง', () => sel(M2.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],
    ['TF-04', 'member', 'deny', 'สมาชิกอื่นอ่านฟีดแบค', () => sel(M.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id))],
    ['TF-05', 'member', 'deny', 'ส่งฟีดแบคงานที่ไม่ได้ร่วมทำ', () => ok(M.client.from('task_feedback').insert({ task_id: T3.task_id, group_id: gid, from_user: M.user.id, to_user: M2.user.id, score: 1 }))],
    ['TF-06', 'collab', 'deny', 'แก้คะแนนฟีดแบคที่ส่งแล้ว', () => state(C.client.from('task_feedback').update({ score: 1 }).eq('feedback_id', feedback.feedback_id), async () => (await L.client.from('task_feedback').select('score').eq('feedback_id', feedback.feedback_id).single()).data?.score === 1)],
    ['TF-07', 'collab', 'deny', 'ลบฟีดแบคที่ส่งแล้ว', () => state(C.client.from('task_feedback').delete().eq('feedback_id', feedback.feedback_id), async () => !(await L.client.from('task_feedback').select('feedback_id').eq('feedback_id', feedback.feedback_id).maybeSingle()).data)],

    // eval_rounds / peer_evaluations
    ['PE-01', 'member', 'deny', 'เปิดรอบประเมิน', () => ok(M.client.from('eval_rounds').insert({ group_id: gid, title: 'by-member', created_by: M.user.id }))],
    ['PE-02', 'member', 'deny', 'ปิดรอบประเมิน', () => state(M.client.from('eval_rounds').update({ status: 'closed', closed_at: nowIso() }).eq('round_id', ER.round_id), async () => (await L.client.from('eval_rounds').select('status').eq('round_id', ER.round_id).single()).data?.status === 'closed')],
    ['PE-03', 'member', 'allow', 'อ่านแบบประเมินที่ตัวเองส่ง', () => sel(M.client.from('peer_evaluations').select('evaluation_id').eq('evaluation_id', myPe.evaluation_id))],
    ['PE-04', 'member2', 'deny', 'ผู้ถูกประเมินอ่านแถวคะแนน', () => sel(M2.client.from('peer_evaluations').select('evaluation_id').eq('evaluation_id', myPe.evaluation_id))],
    ['PE-05', 'leader', 'deny', 'หัวหน้าอ่านแถวคะแนนดิบ', () => sel(L.client.from('peer_evaluations').select('evaluation_id').eq('round_id', ER.round_id))],
    ['PE-06', 'member', 'deny', 'แก้คะแนนที่ส่งแล้ว', () => state(M.client.from('peer_evaluations').update({ quality: 1 }).eq('evaluation_id', myPe.evaluation_id), async () => (await M.client.from('peer_evaluations').select('quality').eq('evaluation_id', myPe.evaluation_id).single()).data?.quality === 1)],
    ['PE-07', 'member', 'deny', 'ลบคะแนนที่ส่งแล้ว', () => state(M.client.from('peer_evaluations').delete().eq('evaluation_id', myPe.evaluation_id), async () => !(await M.client.from('peer_evaluations').select('evaluation_id').eq('evaluation_id', myPe.evaluation_id).maybeSingle()).data)],
    ['PE-08', 'leader', 'deny', 'หัวหน้าประเมินสมาชิก', () => ok(L.client.from('peer_evaluations').insert(pe(L, M)))],
    ['PE-09', 'collab', 'deny', 'ประเมินหัวหน้า', () => ok(C.client.from('peer_evaluations').insert(pe(C, L)))],
    ['PE-10', 'member', 'deny', 'ดูผลประเมิน (หัวหน้าเท่านั้น)', () => rpcData(M.client.rpc('get_peer_eval_results', { p_round_id: ER.round_id }))],
    ['PE-11', 'leader', 'deny', 'ดูผลประเมินขณะรอบยังเปิด', () => rpcData(L.client.rpc('get_peer_eval_results', { p_round_id: ER.round_id }))],
    ['PE-12', 'outsider', 'deny', 'ดูจำนวนผู้ส่งแบบประเมิน', () => rpcData(O.client.rpc('peer_eval_submitted_count', { p_round_id: ER.round_id }))],

    // group_visits
    ['GV-01', 'member', 'allow', 'บันทึกเวลาเข้าดูของตัวเอง', () => ok(M.client.from('group_visits').upsert({ user_id: M.user.id, group_id: gid, last_seen_at: nowIso() }, { onConflict: 'user_id,group_id' }))],
    ['GV-02', 'member', 'deny', 'บันทึกเวลาเข้าดูในนามคนอื่น', () => ok(M.client.from('group_visits').insert({ user_id: M2.user.id, group_id: gid, last_seen_at: nowIso() }))],
    ['GV-03', 'member2', 'deny', 'อ่านเวลาเข้าดูของคนอื่น', () => sel(M2.client.from('group_visits').select('*').eq('user_id', M.user.id))],

    // users
    ['U-01', 'member', 'allow', 'แก้ชื่อที่แสดงของตัวเอง', () => state(M.client.from('users').update({ full_name: 'ผู้ทดสอบ สมาชิก' }).eq('user_id', M.user.id), async () => (await M.client.from('users').select('full_name').eq('user_id', M.user.id).single()).data?.full_name === 'ผู้ทดสอบ สมาชิก')],
    ['U-02', 'member', 'deny', 'แก้ชื่อของคนอื่น', () => state(M.client.from('users').update({ full_name: 'hacked' }).eq('user_id', M2.user.id), async () => (await M2.client.from('users').select('full_name').eq('user_id', M2.user.id).single()).data?.full_name === 'hacked')],
    ['U-03', 'member', 'deny', 'แก้อีเมลในโปรไฟล์ของตัวเอง', () => state(M.client.from('users').update({ email: 'changed@gt-eval.test' }).eq('user_id', M.user.id), async () => (await M.client.from('users').select('email').eq('user_id', M.user.id).single()).data?.email === 'changed@gt-eval.test')],
    ['U-04', 'member', 'allow', 'อ่านโปรไฟล์สมาชิกกลุ่มเดียวกัน', () => sel(M.client.from('users').select('user_id').eq('user_id', M2.user.id))],
    ['U-05', 'outsider', 'deny', 'อ่านโปรไฟล์และอีเมลของคนที่ไม่ได้อยู่กลุ่มเดียวกัน', () => sel(O.client.from('users').select('user_id, email').eq('user_id', M.user.id))],
    ['U-06', 'anon', 'deny', 'อ่านโปรไฟล์ผู้ใช้', () => sel(A.client.from('users').select('user_id').limit(1))],

    // RPC อื่น ๆ
    ['R-01', 'member', 'deny', 'นำสมาชิกออก (หัวหน้าเท่านั้น)', () => state(M.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: M2.user.id }), async () => !(await isMember(M2)))],
    ['R-02', 'leader', 'deny', 'นำหัวหน้าออก', () => state(L.client.rpc('remove_group_member', { p_group_id: gid, p_user_id: L.user.id }), async () => !(await isMember(L)))],
    ['R-03', 'member', 'deny', 'เก็บกลุ่มเข้าคลัง (หัวหน้าเท่านั้น)', () => state(M.client.rpc('archive_group', { p_group_id: gid }), async () => (await groupField('archived_at')) !== null)],
    ['R-04', 'member', 'deny', 'ขอโอนหัวหน้าให้ตัวเอง', () => state(M.client.rpc('request_leader_transfer', { p_group_id: gid, p_user_id: M.user.id }), async () => (await groupField('pending_leader_id')) === M.user.id)],
    ['R-05', 'leader', 'deny', 'เสนอโอนหัวหน้าให้คนนอกกลุ่ม', () => state(L.client.rpc('request_leader_transfer', { p_group_id: gid, p_user_id: O.user.id }), async () => (await groupField('pending_leader_id')) === O.user.id)],
    ['R-06', 'collab', 'deny', 'ตอบรับการโอนหัวหน้าที่ไม่ได้ถูกเสนอ', () => state(C.client.rpc('respond_leader_transfer', { p_group_id: gid, p_accept: true }), async () => (await roleOf(C)) === 'leader')],
    ['R-07', 'anon', 'deny', 'ค้นหาผู้ใช้ด้วยอีเมล', () => rpcData(A.client.rpc('find_user_by_email', { p_email: M.email }))],
    ['R-08', 'outsider', 'deny', 'ค้นหาผู้ใช้ด้วยอีเมล (ไม่ได้เป็นหัวหน้ากลุ่มใด)', () => rpcData(O.client.rpc('find_user_by_email', { p_email: M.email }))],
    ['R-09', 'anon', 'deny', 'ออกจากกลุ่ม', () => ok(A.client.rpc('leave_group', { p_group_id: gid }))],

    // storage
    // ตั้งชื่อไฟล์ไม่ซ้ำและไม่อัปโหลดทับ แบบเดียวกับหน้า profile (ไฟล์ซ้ำจากรอบก่อนทำให้ S-02 ล้มในรอบที่ 2)
    ['S-01', 'member', 'deny', 'อัปโหลดรูปลงโฟลเดอร์ของคนอื่น', () => ok(M.client.storage.from('avatars').upload(`${M2.user.id}/kpi9-${Date.now()}.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })))],
    ['S-02', 'member', 'allow', 'อัปโหลดรูปลงโฟลเดอร์ของตัวเอง', async () => {
      const res = await M.client.storage.from('avatars').upload(`${M.user.id}/kpi9-${Date.now()}.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
      if (res.data?.path) await M.client.storage.from('avatars').remove([res.data.path])
      return { allowed: !res.error, detail: res.error?.message ?? 'no error' }
    }],
    ['S-03', 'anon', 'deny', 'อัปโหลดรูป', () => ok(A.client.storage.from('avatars').upload(`anon/kpi9-${Date.now()}.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })))],

    // กรณีที่เปลี่ยนข้อมูลมาก รันท้ายสุด
    ['Z-01', 'member', 'allow', 'คนหลักกดงานเสร็จ', () => state(M.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', T1.task_id), async () => (await taskField(T1, 'status')) === 'completed')],
    ['Z-02', 'leader', 'allow', 'หัวหน้าลบงาน', () => state(L.client.from('tasks').delete().eq('task_id', TD.task_id), async () => !(await taskExists(TD)))],
    ['Z-03', 'leader', 'deny', 'ถอดสมาชิกออกโดยลบแถวตรง ๆ (ต้องผ่าน RPC)', () => state(L.client.from('group_members').delete().eq('group_id', gid).eq('user_id', M2.user.id), async () => !(await isMember(M2)))],
    ['Z-04', 'leader', 'deny', 'ลบกลุ่มจริง (ต้องเก็บเข้าคลังเพื่อรักษาประวัติ)', async () => {
      const g2 = must(await L.client.from('groups').insert({ group_name: `[TEST] KPI-9 delete r${round} run${run}`, work_mode: 'mixed', join_code: code6(), created_by: L.user.id }).select().single(), 'g2')
      must(await L.client.from('group_members').insert({ group_id: g2.group_id, user_id: L.user.id, role: 'leader' }), 'g2 leader')
      must(await L.client.rpc('log_activity', { p_group_id: g2.group_id, p_action_type: 'group_created', p_entity_type: 'group', p_entity_id: g2.group_id, p_payload: { group_name: g2.group_name, work_mode: 'mixed' } }), 'g2 log')
      const { error } = await L.client.from('groups').delete().eq('group_id', g2.group_id)
      const gone = !(await L.client.from('groups').select('group_id').eq('group_id', g2.group_id).maybeSingle()).data
      if (!gone) await L.client.rpc('archive_group', { p_group_id: g2.group_id })
      return { allowed: gone, detail: error?.message ?? (gone ? 'deleted' : 'still exists') }
    }],
  ]

  // ---------- รัน ----------
  const results = []
  for (const [id, role, expect, desc, fn] of cases) {
    let r
    try { r = await fn() } catch (e) { r = { allowed: false, detail: `exception: ${e.message}` } }
    const actual = r.allowed ? 'allow' : 'deny'
    results.push({ id, role, desc, expect, actual, pass: actual === expect, detail: r.detail })
    console.log(`${actual === expect ? 'PASS' : 'FAIL'} ${id.padEnd(6)} ${role.padEnd(8)} expect=${expect} actual=${actual}  ${desc}  [${r.detail}]`)
  }

  // เก็บกลุ่มทดสอบเข้าคลัง
  await L.client.rpc('archive_group', { p_group_id: gid })

  const passed = results.filter((r) => r.pass).length
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const out = { kpi: 'KPI-9', round: Number(round), run: Number(run), at: nowIso(), commit, group_id: gid, passed, total: results.length, results }
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi9-round${round}-run${run}.json`), JSON.stringify(out, null, 2))
  console.log(`\nKPI-9 round ${round} run ${run}: ${passed}/${results.length} passed`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
