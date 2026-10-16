// KPI-4 ความครบถ้วนของ log: ทำทุกการกระทำผ่านหน้าเว็บจริง แล้วตรวจ log ที่เกิดขึ้นเทียบกับรูปแบบใน AGENTS.md
//
// นิยามที่ใช้ (กำหนดก่อนรันครั้งแรก):
// - "log หนึ่งรายการพอดี" = ชุด log ที่คาดของการกระทำนั้น ไม่ขาดไม่เกิน การกระทำที่กติกาใน AGENTS.md / โค้ดกำหนดให้บันทึกหลายเหตุการณ์
//   นับเป็นชุด เช่น สร้างกลุ่ม = group_created + member_added(leader), สร้างงานแบบมอบหมาย = task_created + task_assigned
// - "payload ถูกต้อง" = มีทุกคีย์ที่บังคับใน AGENTS.md ค่าตรงกับสิ่งที่ทำ ผู้บันทึก (actor) คือคนที่กด และไม่มีคีย์ต้องห้าม
//   คีย์เสริมที่ไม่มีในรูปแบบ AGENTS.md รายงานเป็นข้อสังเกต ไม่นับว่าไม่ผ่าน
// - กรณีบล็อก: หัวหน้าแก้กำหนดส่ง คนทำ ความยาก หรือผู้ร่วมทำโดยไม่ใส่เหตุผล ต้องไม่เกิด log ไม่เปลี่ยนข้อมูล และมีข้อความแจ้ง
//
// วิธีรัน: node kpi4-logs.mjs <round>   หรือ   node kpi4-logs.mjs pilot
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, nowIso, ROOT } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'

const arg = process.argv[2] || 'pilot'
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
const label = pilot ? 'pilot' : `r${round}`
const must = (res, what) => { if (res.error) throw new Error(`fixture: ${what}: ${res.error.message}`); return res.data }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ANY = Symbol('any')
// เทียบค่าแบบไม่สนลำดับคีย์ (jsonb ไม่เก็บลำดับคีย์)
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : Array.isArray(v) ? v.map(canon) : v)
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// รูปแบบ payload จาก AGENTS.md
const SPEC = {
  group_created: { req: ['group_name', 'work_mode'] },
  group_deleted: { req: ['group_name'] },
  member_added: { req: ['role'], opt: ['email'] },
  member_removed: { req: ['email'] },
  member_left: { req: [] },
  leader_transferred: { req: ['to'] },
  task_created: { req: ['title', 'priority', 'deadline'] },
  task_updated: { req: ['title', 'changes'], opt: ['reason'] },
  task_deleted: { req: ['title'] },
  task_status_changed: { req: ['title', 'from', 'to'] },
  task_assigned: { req: ['title', 'assigned_to', 'assignment_type'], opt: ['role'] },
  task_joined: { req: ['title', 'role'] },
  task_feedback_added: { req: ['title'], forbid: ['score', 'to_user', 'from_user', 'comment'] },
  task_accepted: { req: ['title'] },
  task_declined: { req: ['title', 'reason'] },
  task_claimed: { req: ['title'] },
  comment_added: { req: ['title', 'preview'] },
  decision_added: { req: ['title', 'preview'] },
  eval_round_opened: { req: ['title'] },
  eval_round_closed: { req: ['title'] },
}
const REASON_FIELDS = ['deadline', 'assigned_to', 'collaborators', 'difficulty']

function checkLog(log, exp) {
  const problems = []
  const notes = []
  const spec = SPEC[log.action_type]
  const p = log.payload || {}
  if (log.actor_id !== exp.actor) problems.push(`actor ${log.actor_id} != ${exp.actor}`)
  if (!spec) problems.push(`ไม่มี action ${log.action_type} ในรูปแบบ`)
  else {
    for (const k of spec.req) if (!(k in p)) problems.push(`ขาดคีย์ ${k}`)
    for (const k of spec.forbid || []) if (k in p) problems.push(`มีคีย์ต้องห้าม ${k}`)
    for (const k of Object.keys(p)) if (!spec.req.includes(k) && !(spec.opt || []).includes(k)) notes.push(`คีย์เสริม ${k}=${JSON.stringify(p[k])}`)
  }
  if (log.action_type === 'task_updated' && Object.keys(p.changes || {}).some((f) => REASON_FIELDS.includes(f)) && !String(p.reason || '').trim()) problems.push('ไม่มีเหตุผลทั้งที่เปลี่ยนฟิลด์ที่บังคับเหตุผล')
  for (const [k, v] of Object.entries(exp.values || {})) {
    if (v === ANY) continue
    if (!same(p[k], v)) problems.push(`${k}: ${JSON.stringify(p[k])} != ${JSON.stringify(v)}`)
  }
  return { problems, notes }
}

async function main() {
  const roles = {
    L: await signInAs('k4leader', 'ผู้ทดสอบ หัวหน้า KPI4'),
    M: await signInAs('k4member', 'ผู้ทดสอบ สมาชิก KPI4'),
    M2: await signInAs('k4member2', 'ผู้ทดสอบ สมาชิกสอง KPI4'),
    C: await signInAs('k4collab', 'ผู้ทดสอบ ผู้ร่วมทำ KPI4'),
    R: await signInAs('k4removed', 'ผู้ทดสอบ ถูกนำออก KPI4'),
  }
  const { L, M, M2, C, R } = roles
  const { data: old } = await L.client.from('groups').select('group_id').eq('created_by', L.user.id).is('archived_at', null)
  for (const g of old || []) await L.client.rpc('archive_group', { p_group_id: g.group_id })

  const pages = {}
  for (const [k, role] of [['L', 'k4leader'], ['M', 'k4member'], ['M2', 'k4member2'], ['C', 'k4collab']]) pages[k] = await pageAs(role)
  const groupName = `[TEST] KPI-4 ${label}`
  let gid = null
  let lastSeq = 0
  const reader = () => L.client // หัวหน้าคนแรกยังเป็นสมาชิกตลอดการทดสอบ อ่าน log ได้

  const go = async (who, tab) => {
    const page = pages[who]
    await page.goto(`${BASE_URL}/dashboard/groups/${gid}${tab ? `?tab=${tab}` : ''}`)
    await page.waitForLoadState('networkidle')
    return page
  }
  const card = (page, title) => page.locator('div.p-5.space-y-3').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  const fetchNewLogs = async () => must(await reader().from('activity_logs').select('seq, actor_id, action_type, payload, created_at').eq('group_id', gid).gt('seq', lastSeq).order('seq'), 'logs')
  const taskByTitle = async (title) => must(await L.client.from('tasks').select('*').eq('group_id', gid).eq('title', title).maybeSingle(), 'task')

  const createTask = async (title, { priority = 'medium', difficulty = 'medium', deadline = '', headcount = 1, assignee = null, collab = null }) => {
    const page = await go('L', 'tasks')
    await page.getByRole('button', { name: '+ สร้างงาน' }).click()
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'บันทึกสร้างงาน' }) })
    await form.getByPlaceholder('เช่น ออกแบบหน้าหลัก, ตรวจสอบระบบฐานข้อมูล').fill(title)
    await form.locator('select').nth(0).selectOption(priority)
    await form.locator('select').nth(1).selectOption(difficulty)
    if (deadline) await form.locator('input[type="datetime-local"]').fill(deadline)
    await form.locator('select').nth(2).selectOption(String(headcount))
    if (assignee) {
      await form.locator('select').nth(3).selectOption(assignee.user.id)
      if (collab) await form.locator('label').filter({ hasText: collab.fullName }).locator('input[type="checkbox"]').check()
    } else {
      await form.getByText('เปิดให้สมาชิกเลือกเอง').click()
    }
    await form.getByRole('button', { name: 'บันทึกสร้างงาน' }).click()
  }
  const openEdit = async (title) => {
    const page = await go('L', 'tasks')
    await card(page, title).getByRole('button', { name: 'แก้ไขงาน' }).click()
    return { page, modal: page.locator('div.fixed').filter({ hasText: `แก้ไขงาน: ${title}` }) }
  }

  for (const r of Object.values(roles)) r.fullName = must(await r.client.from('users').select('full_name').eq('user_id', r.user.id).single(), 'name').full_name

  const T = { T1: `K4-T1 ${label}`, T2: `K4-T2 ${label}`, T3: `K4-T3 ${label}`, T4: `K4-T4 ${label}`, T5: `K4-T5 ${label}`, T6: `K4-T6 ${label}`, T7: `K4-T7 ${label}` }
  const URL = 'https://docs.google.com/document/d/kpi4'
  const REASON = (s) => `เหตุผลทดสอบ ${s}`

  // [id, คำอธิบาย, การกระทำผ่านหน้าเว็บ, log ที่คาด (หรือ 'blocked')]
  const steps = [
    ['S01', 'หัวหน้าสร้างกลุ่ม', async () => {
      const page = pages.L
      await page.goto(`${BASE_URL}/dashboard/projects/new`)
      await page.getByRole('button', { name: 'สร้างกลุ่มใหม่' }).click()
      await page.getByPlaceholder('เช่น โปรเจกต์วิทยานิพนธ์').fill(groupName)
      await page.getByRole('button', { name: 'สร้างกลุ่ม', exact: true }).click()
      await page.getByText('สร้างกลุ่มสำเร็จ').waitFor({ timeout: 30000 })
      gid = must(await L.client.from('groups').select('group_id').eq('group_name', groupName).eq('created_by', L.user.id).single(), 'gid').group_id
    }, () => [{ action: 'group_created', actor: L.user.id, values: { group_name: groupName, work_mode: 'mixed' } }, { action: 'member_added', actor: L.user.id, values: { role: 'leader' } }]],
    ['S02', 'สมาชิกเข้ากลุ่มด้วยรหัส', async () => {
      const code = must(await L.client.from('groups').select('join_code').eq('group_id', gid).single(), 'code').join_code
      const page = pages.M
      await page.goto(`${BASE_URL}/dashboard/projects/join`)
      const boxes = page.locator('input[maxlength="1"]')
      for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code[i])
      await page.getByRole('button', { name: 'เข้าร่วมกลุ่ม' }).click()
      await page.waitForURL(`**/dashboard/groups/${gid}**`, { timeout: 30000 })
      // ผู้ร่วมทำและคนที่จะถูกนำออกเข้ากลุ่มผ่าน RPC เดียวกัน (ไม่ใช่ขั้นที่ประเมิน)
    }, () => [{ action: 'member_added', actor: M.user.id, values: { role: 'member' } }]],
    ['S03', 'หัวหน้าเพิ่มสมาชิกด้วยอีเมล', async () => {
      for (const u of [C, R]) must(await u.client.rpc('join_group_by_code', { p_code: must(await L.client.from('groups').select('join_code').eq('group_id', gid).single(), 'c').join_code }), 'join')
      lastSeq = Math.max(lastSeq, ...(await fetchNewLogs()).map((l) => l.seq))
      const page = await go('L', 'members')
      await page.getByPlaceholder('example@email.com').fill(M2.email)
      await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click()
    }, () => [{ action: 'member_added', actor: L.user.id, values: { role: 'member', email: M2.email } }]],
    ['S04', 'หัวหน้าสร้างงานและมอบหมาย', () => createTask(T.T1, { priority: 'high', deadline: '2026-11-20T17:00', assignee: M }),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T1, priority: 'high', deadline: '2026-11-20T10:00:00+00:00' } }, { action: 'task_assigned', actor: L.user.id, values: { title: T.T1, assigned_to: M.user.id, assignment_type: 'leader_assign' } }]],
    ['S05', 'สมาชิกรับงาน', async () => { const p = await go('M', 'tasks'); await card(p, T.T1).getByRole('button', { name: 'รับงาน', exact: true }).click() },
      () => [{ action: 'task_accepted', actor: M.user.id, values: { title: T.T1 } }]],
    ['S06', 'สมาชิกเริ่มทำงาน', async () => { const p = await go('M', 'tasks'); await card(p, T.T1).getByRole('button', { name: 'เริ่มทำงาน' }).click() },
      () => [{ action: 'task_status_changed', actor: M.user.id, values: { title: T.T1, from: 'accepted', to: 'in_progress' } }]],
    ['S07', 'สมาชิกเขียนความเห็น', async () => {
      const p = await go('M', 'tasks'); const c = card(p, T.T1)
      await c.getByRole('button', { name: 'บันทึกความคืบหน้าและการตัดสินใจ' }).click()
      await c.getByPlaceholder('เช่น แก้บทที่ 2 เพิ่มรูปประกอบแล้ว').fill('ความเห็นทดสอบ KPI-4')
      await c.getByRole('button', { name: 'บันทึก', exact: true }).click()
    }, () => [{ action: 'comment_added', actor: M.user.id, values: { title: T.T1, preview: 'ความเห็นทดสอบ KPI-4' } }]],
    ['S08', 'สมาชิกบันทึกการตัดสินใจ', async () => {
      const p = await go('M', 'tasks'); const c = card(p, T.T1)
      await c.getByRole('button', { name: 'บันทึกความคืบหน้าและการตัดสินใจ' }).click()
      await c.locator('select').last().selectOption('decision')
      await c.getByPlaceholder('เช่น ตกลงเปลี่ยนหัวข้อบทที่ 3 เพราะ...').fill('การตัดสินใจทดสอบ KPI-4')
      await c.getByRole('button', { name: 'บันทึก', exact: true }).click()
    }, () => [{ action: 'decision_added', actor: M.user.id, values: { title: T.T1, preview: 'การตัดสินใจทดสอบ KPI-4' } }]],
    ['S09', 'สมาชิกแนบลิงก์ผลงาน', async () => {
      const p = await go('M', 'tasks'); const c = card(p, T.T1)
      await c.getByRole('button', { name: '+ แนบลิงก์ผลงาน' }).click()
      await c.getByPlaceholder('วางลิงก์ Google Docs, Slides, Canva ฯลฯ').fill(URL)
      await c.getByRole('button', { name: 'บันทึกลิงก์' }).click()
    }, () => [{ action: 'task_updated', actor: M.user.id, values: { title: T.T1, changes: { work_url: { from: null, to: URL } } } }]],
    ['S10', 'สมาชิกกดงานเสร็จ', async () => { const p = await go('M', 'tasks'); await card(p, T.T1).getByRole('button', { name: 'ทำเสร็จแล้ว' }).click() },
      () => [{ action: 'task_status_changed', actor: M.user.id, values: { title: T.T1, from: 'in_progress', to: 'completed' } }]],
    ['S11', 'หัวหน้าสร้างงานมอบหมายให้สมาชิกสอง', () => createTask(T.T2, { assignee: M2 }),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T2, priority: 'medium', deadline: null } }, { action: 'task_assigned', actor: L.user.id, values: { title: T.T2, assigned_to: M2.user.id, assignment_type: 'leader_assign' } }]],
    ['S12', 'สมาชิกปฏิเสธงานพร้อมเหตุผล', async () => {
      const p = await go('M2', 'tasks')
      await card(p, T.T2).getByRole('button', { name: 'ปฏิเสธ', exact: true }).click()
      await p.getByPlaceholder('เช่น ภาระงานปัจจุบันเต็มแล้ว, ทักษะไม่ตรง...').fill(REASON('S12'))
      await p.getByRole('button', { name: 'ยืนยันปฏิเสธงาน' }).click()
    }, () => [{ action: 'task_declined', actor: M2.user.id, values: { title: T.T2, reason: REASON('S12') } }]],
    ['S13', 'หัวหน้ามอบหมายงานที่ถูกปฏิเสธให้คนใหม่', async () => {
      const p = await go('L', 'tasks')
      await card(p, T.T2).getByRole('button', { name: 'เปลี่ยนผู้รับผิดชอบ' }).click()
      const modal = p.locator('div.fixed').filter({ has: p.getByRole('button', { name: 'มอบหมายงานใหม่' }) })
      await modal.locator('select').selectOption(M.user.id)
      await modal.getByRole('button', { name: 'มอบหมายงานใหม่' }).click()
    }, () => [{ action: 'task_assigned', actor: L.user.id, values: { title: T.T2, assigned_to: M.user.id, assignment_type: 'leader_assign' } }]],
    ['S14', 'หัวหน้าสร้างงานให้สมาชิกเลือกเอง', () => createTask(T.T3, {}),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T3, priority: 'medium', deadline: null } }]],
    ['S15', 'สมาชิกเลือกรับงานเอง', async () => { const p = await go('M2', 'tasks'); await card(p, T.T3).getByRole('button', { name: 'เลือกรับงานนี้' }).click() },
      () => [{ action: 'task_claimed', actor: M2.user.id, values: { title: T.T3 } }]],
    ['S16', 'หัวหน้าสร้างงานสำหรับทดสอบการแก้ไข', () => createTask(T.T4, { deadline: '2026-11-10T12:00', assignee: M }),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T4, priority: 'medium', deadline: '2026-11-10T05:00:00+00:00' } }, { action: 'task_assigned', actor: L.user.id, values: { title: T.T4, assigned_to: M.user.id, assignment_type: 'leader_assign' } }]],
    ['S17', 'บล็อก: แก้กำหนดส่งโดยไม่ใส่เหตุผล', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('input[type="datetime-local"]').fill('2026-11-15T12:00')
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
      await modal.getByText('กรุณาระบุเหตุผลของการเปลี่ยนแปลง').waitFor({ timeout: 10000 })
      await modal.getByRole('button', { name: 'ยกเลิก' }).click()
    }, 'blocked', async () => String((await taskByTitle(T.T4)).deadline).startsWith('2026-11-10T05:00')],
    ['S18', 'บล็อก: เปลี่ยนคนทำโดยไม่ใส่เหตุผล', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('select').nth(3).selectOption(M2.user.id)
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
      await modal.getByText('กรุณาระบุเหตุผลของการเปลี่ยนแปลง').waitFor({ timeout: 10000 })
      await modal.getByRole('button', { name: 'ยกเลิก' }).click()
    }, 'blocked', async () => (await taskByTitle(T.T4)).assigned_to === M.user.id],
    ['S19', 'บล็อก: เปลี่ยนความยากโดยไม่ใส่เหตุผล', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('select').nth(1).selectOption('hard')
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
      await modal.getByText('กรุณาระบุเหตุผลของการเปลี่ยนแปลง').waitFor({ timeout: 10000 })
      await modal.getByRole('button', { name: 'ยกเลิก' }).click()
    }, 'blocked', async () => (await taskByTitle(T.T4)).difficulty === 'medium'],
    ['S20', 'บล็อก: เพิ่มผู้ร่วมทำโดยไม่ใส่เหตุผล', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('select').nth(2).selectOption('2')
      await modal.locator('label').filter({ hasText: C.fullName }).locator('input[type="checkbox"]').check()
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
      await modal.getByText('กรุณาระบุเหตุผลของการเปลี่ยนแปลง').waitFor({ timeout: 10000 })
      await modal.getByRole('button', { name: 'ยกเลิก' }).click()
    }, 'blocked', async () => (await taskByTitle(T.T4)).headcount === 1 && (await L.client.from('task_collaborators').select('user_id').eq('task_id', (await taskByTitle(T.T4)).task_id)).data.length === 0],
    ['S21', 'หัวหน้าแก้กำหนดส่งพร้อมเหตุผล', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('input[type="datetime-local"]').fill('2026-11-15T12:00')
      await modal.getByPlaceholder('เช่น อาจารย์เลื่อนกำหนดส่ง, สมาชิกป่วย, งานยากกว่าที่ประเมินไว้').fill(REASON('S21'))
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
    }, () => [{ action: 'task_updated', actor: L.user.id, values: { title: T.T4, reason: REASON('S21'), changes: ANY } }]],
    ['S22', 'หัวหน้าแก้ชื่องาน (ไม่บังคับเหตุผล)', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.locator('input[type="text"]').first().fill(`${T.T4} แก้ชื่อ`)
      await modal.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
      T.T4 = `${T.T4} แก้ชื่อ`
    }, () => [{ action: 'task_updated', actor: L.user.id, values: { title: T.T4, changes: { title: { from: T.T4.replace(' แก้ชื่อ', ''), to: T.T4 } } } }]],
    ['S23', 'หัวหน้าสร้างงานสองคนพร้อมเชิญผู้ร่วมทำ', () => createTask(T.T5, { headcount: 2, assignee: M, collab: C }),
      () => [
        { action: 'task_created', actor: L.user.id, values: { title: T.T5, priority: 'medium', deadline: null } },
        { action: 'task_assigned', actor: L.user.id, values: { title: T.T5, assigned_to: M.user.id, assignment_type: 'leader_assign' } },
        { action: 'task_assigned', actor: L.user.id, values: { title: T.T5, assigned_to: C.user.id, assignment_type: 'leader_assign', role: 'collaborator' } },
      ]],
    ['S24', 'ผู้ร่วมทำรับคำเชิญ', async () => { const p = await go('C', 'tasks'); await card(p, T.T5).getByRole('button', { name: 'รับงาน', exact: true }).click() },
      () => [{ action: 'task_joined', actor: C.user.id, values: { title: T.T5, role: 'collaborator' } }]],
    ['S25', 'หัวหน้าสร้างงานสองคน (ยังไม่เชิญ)', () => createTask(T.T6, { headcount: 2, assignee: M }),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T6, priority: 'medium', deadline: null } }, { action: 'task_assigned', actor: L.user.id, values: { title: T.T6, assigned_to: M.user.id, assignment_type: 'leader_assign' } }]],
    ['S26', 'หัวหน้าเชิญผู้ร่วมทำจากการ์ดงาน', async () => {
      const p = await go('L', 'tasks'); const c = card(p, T.T6)
      await c.locator('select').filter({ hasText: 'เชิญผู้ร่วมทำ' }).selectOption(M2.user.id)
      await c.getByRole('button', { name: 'เชิญ', exact: true }).click()
    }, () => [{ action: 'task_assigned', actor: L.user.id, values: { title: T.T6, assigned_to: M2.user.id, assignment_type: 'leader_assign', role: 'collaborator' } }]],
    ['S27', 'ผู้ถูกเชิญปฏิเสธพร้อมเหตุผล', async () => {
      const p = await go('M2', 'tasks'); const c = card(p, T.T6)
      await c.getByRole('button', { name: 'ปฏิเสธ', exact: true }).click()
      await c.getByPlaceholder('เหตุผลในการปฏิเสธ (บังคับ)').fill(REASON('S27'))
      await c.getByRole('button', { name: 'ยืนยันปฏิเสธ' }).click()
    }, () => [{ action: 'task_declined', actor: M2.user.id, values: { title: T.T6, reason: REASON('S27') } }]],
    ['S28', 'หัวหน้าสร้างงานเลือกเองสองคน', () => createTask(T.T7, { headcount: 2 }),
      () => [{ action: 'task_created', actor: L.user.id, values: { title: T.T7, priority: 'medium', deadline: null } }]],
    ['S29', 'สมาชิกเข้าร่วมงานว่างเป็นผู้ร่วมทำ', async () => { const p = await go('C', 'tasks'); await card(p, T.T7).getByRole('button', { name: 'เข้าร่วมทำ' }).click() },
      () => [{ action: 'task_joined', actor: C.user.id, values: { title: T.T7, role: 'collaborator' } }]],
    ['S30', 'สมาชิกรับงานสองคน', async () => { const p = await go('M', 'tasks'); await card(p, T.T5).getByRole('button', { name: 'รับงาน', exact: true }).click() },
      () => [{ action: 'task_accepted', actor: M.user.id, values: { title: T.T5 } }]],
    ['S31', 'คนหลักกดงานสองคนเสร็จ', async () => { const p = await go('M', 'tasks'); await card(p, T.T5).getByRole('button', { name: 'ทำเสร็จแล้ว' }).click() },
      () => [{ action: 'task_status_changed', actor: M.user.id, values: { title: T.T5, from: 'accepted', to: 'completed' } }]],
    ['S32', 'ผู้ร่วมทำส่งฟีดแบค (ห้ามมีคะแนนใน log)', async () => {
      const p = await go('C', 'tasks'); const c = card(p, T.T5)
      await c.getByRole('button', { name: '4', exact: true }).click()
      await c.getByRole('button', { name: 'ส่ง', exact: true }).click()
    }, () => [{ action: 'task_feedback_added', actor: C.user.id, values: { title: T.T5 } }]],
    ['S33', 'หัวหน้าลบงาน', async () => {
      const { modal } = await openEdit(T.T4)
      await modal.getByRole('button', { name: 'ลบงาน' }).click()
      await modal.getByRole('button', { name: 'ยืนยันลบงาน' }).click()
    }, () => [{ action: 'task_deleted', actor: L.user.id, values: { title: T.T4 } }]],
    ['S34', 'หัวหน้าเปิดรอบประเมินเพื่อน', async () => {
      const p = await go('L', 'evaluation')
      await p.getByPlaceholder('ชื่อรอบ เช่น รอบกลางโครงการ').fill(`รอบทดสอบ ${label}`)
      await p.getByRole('button', { name: 'เปิดรอบประเมิน' }).click()
    }, () => [{ action: 'eval_round_opened', actor: L.user.id, values: { title: `รอบทดสอบ ${label}` } }]],
    ['S35', 'หัวหน้าปิดรอบประเมินเพื่อน', async () => { const p = await go('L', 'evaluation'); await p.getByRole('button', { name: 'ปิดรอบและดูผล' }).click() },
      () => [{ action: 'eval_round_closed', actor: L.user.id, values: { title: `รอบทดสอบ ${label}` } }]],
    ['S36', 'หัวหน้านำสมาชิกออก', async () => {
      const p = await go('L', 'members'); const row = p.locator('li').filter({ hasText: R.fullName })
      await row.getByRole('button', { name: 'นำออก' }).click()
      await row.getByRole('button', { name: 'ยืนยัน' }).click()
    }, () => [{ action: 'member_removed', actor: L.user.id, values: { email: R.email } }]],
    ['S37', 'สมาชิกออกจากกลุ่มเอง', async () => {
      const p = await go('M2', 'members'); const row = p.locator('li').filter({ hasText: M2.fullName })
      await row.getByRole('button', { name: 'ออกจากกลุ่ม' }).click()
      await row.getByRole('button', { name: 'ยืนยัน' }).click()
    }, () => [{ action: 'member_left', actor: M2.user.id, values: {} }]],
    ['S38', 'หัวหน้าเสนอโอนหัวหน้า (ไม่มี log จนกว่าจะตอบรับ)', async () => {
      const p = await go('L', 'members'); const row = p.locator('li').filter({ hasText: M.fullName })
      await row.getByRole('button', { name: 'โอนหัวหน้า' }).click()
      await row.getByRole('button', { name: 'ยืนยัน' }).click()
      await row.getByText('รอตอบรับเป็นหัวหน้า').waitFor({ timeout: 15000 })
    }, () => []],
    ['S39', 'สมาชิกตอบรับเป็นหัวหน้า', async () => { const p = await go('M'); await p.getByRole('button', { name: 'ตอบรับ', exact: true }).click() },
      () => [{ action: 'leader_transferred', actor: M.user.id, values: { to: M.email } }]],
    ['S40', 'หัวหน้าคนใหม่ลบกลุ่ม (เก็บเข้าคลัง)', async () => {
      const p = await go('M')
      await p.getByRole('button', { name: 'ลบกลุ่ม' }).click()
      await p.getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    }, () => [{ action: 'group_deleted', actor: M.user.id, values: { group_name: groupName } }]],
  ]

  const results = []
  for (const [id, desc, run, expectFn, unchanged] of steps) {
    let error = null
    try { await run() } catch (e) { error = e.message.split('\n')[0] }
    const blocked = expectFn === 'blocked'
    const expected = blocked ? [] : expectFn()
    // รอ log ที่คาดให้ครบ แล้วรออีกเล็กน้อยเพื่อจับ log ที่เกินมา
    const deadline = Date.now() + 15000
    let logs = gid ? await fetchNewLogs() : []
    while (!error && logs.length < expected.length && Date.now() < deadline) { await sleep(500); logs = await fetchNewLogs() }
    await sleep(2000)
    logs = gid ? await fetchNewLogs() : []
    if (logs.length) lastSeq = logs[logs.length - 1].seq

    const problems = []
    const notes = []
    if (error) problems.push(`หน้าเว็บ: ${error}`)
    if (blocked && !(await unchanged())) problems.push('ข้อมูลถูกเปลี่ยนทั้งที่ควรถูกบล็อก')
    if (logs.length !== expected.length) problems.push(`จำนวน log ${logs.length} (คาด ${expected.length}): ${logs.map((l) => l.action_type).join(', ')}`)
    const remaining = [...logs]
    for (const e of expected) {
      const idx = remaining.findIndex((l) => l.action_type === e.action && checkLog(l, e).problems.length === 0)
      const cand = idx >= 0 ? idx : remaining.findIndex((l) => l.action_type === e.action)
      if (cand < 0) { problems.push(`ไม่พบ ${e.action}`); continue }
      const r = checkLog(remaining[cand], e)
      problems.push(...r.problems.map((x) => `${e.action}: ${x}`))
      notes.push(...r.notes.map((x) => `${e.action}: ${x}`))
      remaining.splice(cand, 1)
    }
    const pass = problems.length === 0
    results.push({ id, desc, blocked, pass, expected: expected.map((e) => e.action), logs: logs.map((l) => ({ seq: l.seq, action: l.action_type, actor: l.actor_id, payload: l.payload })), problems, notes })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${desc}${problems.length ? '  ' + JSON.stringify(problems) : ''}${notes.length ? '  (หมายเหตุ: ' + notes.join('; ') + ')' : ''}`)
  }

  await closeBrowser()
  const passed = results.filter((r) => r.pass).length
  const actions = [...new Set(results.flatMap((r) => r.expected))]
  console.log(`\nKPI-4 ${label}: ${passed}/${results.length} steps passed; action types covered ${actions.length}/${Object.keys(SPEC).length}`)
  if (pilot) return
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi4-round${round}.json`), JSON.stringify({ kpi: 'KPI-4', round, at: nowIso(), commit, group_id: gid, passed, total: results.length, pass: passed === results.length, actionsCovered: actions, results }, null, 2))
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
