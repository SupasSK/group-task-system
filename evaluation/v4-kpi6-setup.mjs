// เกณฑ์ฉบับที่ 4 KPI-6 เตรียมกลุ่มทดสอบสำหรับ Lighthouse (รันครั้งเดียวก่อนวัด)
// หัวหน้า + สมาชิก 5 คน, งาน 30 งาน (ครบทุกสถานะ, มีผู้ร่วมทำบางงาน), ประวัติกิจกรรมอย่างน้อย 200 รายการ
// เขียนผลลง evaluation/v4-kpi6-fixture.json (commit ไฟล์นี้เพื่อให้ทุกรอบวัดกลุ่มเดียวกัน)
// วิธีรัน: node v4-kpi6-setup.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { signInAs, nowIso, HERE } from './lib.mjs'
import { must, logAs, createGroup } from './v4-lib.mjs'

const MIN_LOGS = 200
const L = await signInAs('k4leader', 'ผู้ทดสอบ หัวหน้า KPI4')
const members = []
for (const role of ['k4member', 'k4member2', 'k4collab', 'k1member', 'k1member2']) members.push(await signInAs(role, role))

const G = await createGroup(L, '[TEST] v4 KPI-6 ประสิทธิภาพ', members)
const gid = G.group_id
const log = (u, action, entityId, payload) => logAs(u, gid, action, 'task', entityId, payload)
const statuses = ['pending', 'assigned', 'accepted', 'in_progress', 'completed', 'rejected']

for (let i = 0; i < 30; i++) {
  const status = statuses[i % statuses.length]
  const open = status === 'pending'
  const main = members[i % members.length]
  const withCollab = !open && i % 3 === 0
  const t = must(await L.client.from('tasks').insert({
    group_id: gid, title: `งานทดสอบที่ ${i + 1}`, description: 'รายละเอียดงานสำหรับวัดประสิทธิภาพ',
    priority: ['low', 'medium', 'high', 'urgent'][i % 4], difficulty: ['easy', 'medium', 'hard'][i % 3], headcount: withCollab ? 2 : 1,
    status, assignment_type: open ? 'open_choice' : 'leader_assign', assigned_to: open ? null : main.user.id, assigned_by: L.user.id,
    deadline: new Date(Date.now() + (i - 10) * 86400000).toISOString(), completed_at: status === 'completed' ? nowIso() : null, updated_at: nowIso(),
  }).select().single(), `task ${i + 1}`)
  await log(L, 'task_created', t.task_id, { title: t.title, priority: t.priority, deadline: t.deadline })
  if (withCollab) {
    const other = members[(i + 1) % members.length]
    must(await L.client.from('task_collaborators').insert({ task_id: t.task_id, group_id: gid, user_id: other.user.id, status: 'pending' }), 'invite')
    must(await other.client.from('task_collaborators').update({ status: 'accepted', responded_at: nowIso() }).eq('task_id', t.task_id).eq('user_id', other.user.id), 'accept')
    await log(other, 'task_joined', t.task_id, { title: t.title, role: 'collaborator' })
  }
  // ความเห็นและการตัดสินใจ 6 รายการต่องาน บันทึกทั้งในตารางความเห็นและ log เหมือนหน้าเว็บ
  for (let k = 0; k < 6; k++) {
    const u = members[(i + k) % members.length]
    const kind = k % 3 === 2 ? 'decision' : 'comment'
    const body = `ความคืบหน้างานที่ ${i + 1} ครั้งที่ ${k + 1}`
    must(await u.client.from('task_comments').insert({ group_id: gid, task_id: t.task_id, author_id: u.user.id, kind, body }), 'comment')
    await log(u, kind === 'decision' ? 'decision_added' : 'comment_added', t.task_id, { title: t.title, preview: body })
  }
}

const { count } = await L.client.from('activity_logs').select('log_id', { count: 'exact', head: true }).eq('group_id', gid)
const fixture = { criteria: 'v4', kpi: 'KPI-6', group_id: gid, leader: L.email, members: members.map((m) => m.email), tasks: 30, logs: count, createdAt: nowIso() }
writeFileSync(join(HERE, 'v4-kpi6-fixture.json'), JSON.stringify(fixture, null, 2))
console.log(JSON.stringify(fixture, null, 2))
if (count < MIN_LOGS) console.error(`log มี ${count} รายการ น้อยกว่า ${MIN_LOGS} ตามเกณฑ์`)
