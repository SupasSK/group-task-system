// KPI-10 เตรียมข้อมูล: กลุ่ม "[TEST] KPI-10" ที่มีขนาดใกล้กลุ่มจริง (หัวหน้า + สมาชิก 10 คน, 20 งาน, ประมาณ 40 log)
// ใช้บัญชีทดสอบที่สมัครไว้แล้ว (เปิดยืนยันอีเมลแล้วจึงสมัครใหม่ไม่ได้) เขียนผลลง evaluation/kpi10-fixture.json
// วิธีรัน: node kpi10-setup.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { signInAs, nowIso, HERE } from './lib.mjs'

const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const MEMBER_ROLES = ['member', 'member2', 'collab', 'k1member', 'k1member2', 'k2member', 'k2viewer', 'k4member', 'k4member2', 'k4collab']

const L = await signInAs('k6leader', 'ผู้ทดสอบ หัวหน้า KPI6')
const members = []
for (const role of MEMBER_ROLES) members.push(await signInAs(role, role))

const join_code = code6()
const g = must(await L.client.from('groups').insert({ group_name: '[TEST] KPI-10 โหลดทดสอบ', description: 'กลุ่มสำหรับวัดประสิทธิภาพ', work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
must(await L.client.from('group_members').insert({ group_id: g.group_id, user_id: L.user.id, role: 'leader' }), 'leader')
const log = async (u, action, entityId, payload) => must(await u.client.rpc('log_activity', { p_group_id: g.group_id, p_action_type: action, p_entity_type: 'task', p_entity_id: entityId, p_payload: payload }), 'log')
for (const m of members) must(await m.client.rpc('join_group_by_code', { p_code: join_code }), `join ${m.role}`)

const statuses = ['assigned', 'accepted', 'in_progress', 'completed', 'pending']
for (let i = 0; i < 20; i++) {
  const m = members[i % members.length]
  const status = statuses[i % statuses.length]
  const open = status === 'pending'
  const t = must(await L.client.from('tasks').insert({
    group_id: g.group_id, title: `งานทดสอบที่ ${i + 1}`, description: 'รายละเอียดงานสำหรับวัดประสิทธิภาพ', priority: ['low', 'medium', 'high', 'urgent'][i % 4], difficulty: ['easy', 'medium', 'hard'][i % 3],
    status, assignment_type: open ? 'open_choice' : 'leader_assign', assigned_to: open ? null : m.user.id, assigned_by: L.user.id,
    deadline: new Date(Date.now() + (i - 5) * 86400000).toISOString(), completed_at: status === 'completed' ? nowIso() : null, updated_at: nowIso(),
  }).select().single(), 'task')
  await log(L, 'task_created', t.task_id, { title: t.title, priority: t.priority, deadline: t.deadline })
  if (!open) await log(m, 'comment_added', t.task_id, { title: t.title, preview: `ความคืบหน้างานที่ ${i + 1}` })
}

const fixture = { group_id: g.group_id, join_code, leader: L.email, accounts: [L.email, ...members.map((m) => m.email)], createdAt: nowIso() }
writeFileSync(join(HERE, 'kpi10-fixture.json'), JSON.stringify(fixture, null, 2))
console.log(JSON.stringify(fixture, null, 2))
