// KPI-2 ความครบถ้วนของสรุปสิ่งที่พลาดไป (นิยามตามเกณฑ์ฉบับที่ 2)
// ชุด A เกิดก่อนผู้ดูกด "รับทราบ" ผ่านหน้าเว็บ, ชุด B เกิดหลังจากนั้น 10 เหตุการณ์หลายประเภท
// วิธีรัน: node kpi2-digest.mjs <round>   หรือ   node kpi2-digest.mjs pilot
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, nowIso, ROOT, SUPABASE_URL, ANON_KEY } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'

const arg = process.argv[2] || 'pilot'
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
const label = pilot ? 'pilot' : `r${round}`
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const must = (res, what) => { if (res.error) throw new Error(`fixture: ${what}: ${res.error.message}`); return res.data }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const X = await signInAs('k2leader', 'ผู้ทดสอบ หัวหน้า KPI2')
  const Y = await signInAs('k2member', 'ผู้ทดสอบ สมาชิก KPI2')
  const V = await signInAs('k2viewer', 'ผู้ทดสอบ ผู้ดู KPI2')

  const { data: old } = await X.client.from('groups').select('group_id').eq('created_by', X.user.id).is('archived_at', null)
  for (const g of old || []) await X.client.rpc('archive_group', { p_group_id: g.group_id })

  const log = async (u, gid, action, entityType, entityId, payload) =>
    must(await u.client.rpc('log_activity', { p_group_id: gid, p_action_type: action, p_entity_type: entityType, p_entity_id: entityId, p_payload: payload }), `log ${action}`)
  const mkGroup = async (name) => {
    const join_code = code6()
    const g = must(await X.client.from('groups').insert({ group_name: name, work_mode: 'mixed', join_code, created_by: X.user.id }).select().single(), 'group')
    must(await X.client.from('group_members').insert({ group_id: g.group_id, user_id: X.user.id, role: 'leader' }), 'leader')
    await log(X, g.group_id, 'group_created', 'group', g.group_id, { group_name: name, work_mode: 'mixed' })
    for (const u of [Y, V]) must(await u.client.rpc('join_group_by_code', { p_code: join_code }), 'join')
    return g
  }

  // สถานการณ์เพิ่ม: กลุ่ม H ที่ผู้ดูเป็นสมาชิก มีกิจกรรมที่ยังไม่อ่าน แล้วถูกเก็บเข้าคลัง
  const H = await mkGroup(`[TEST] KPI-2 archived ${label}`)
  await log(Y, H.group_id, 'comment_added', 'group', H.group_id, { title: 'H', preview: 'H-unread' })
  must(await X.client.rpc('archive_group', { p_group_id: H.group_id }), 'archive H')

  const G = await mkGroup(`[TEST] KPI-2 ${label}`)
  const gid = G.group_id
  const tasks = []
  for (let i = 1; i <= 14; i++) {
    tasks.push(must(await X.client.from('tasks').insert({ group_id: gid, title: `K2-T${i}`, priority: 'medium', status: 'pending', assignment_type: 'open_choice', assigned_by: X.user.id, updated_at: nowIso() }).select().single(), 'task'))
  }
  const T = (i) => tasks[i - 1]

  // ชุด A (ก่อนรับทราบ)
  const A = [
    [Y, 'comment_added', T(1), { title: 'K2-T1', preview: 'A01' }, 'เขียนบันทึก: A01'],
    [X, 'decision_added', T(2), { title: 'K2-T2', preview: 'A02' }, 'บันทึกการตัดสินใจ: A02'],
    [Y, 'comment_added', T(3), { title: 'K2-T3', preview: 'A03' }, 'เขียนบันทึก: A03'],
  ]
  for (const [u, action, t, payload] of A) await log(u, gid, action, 'task', t.task_id, payload)

  // ผู้ดูเปิดหน้ากลุ่มแล้วกด "รับทราบ" ผ่านหน้าเว็บ
  await sleep(2000)
  const page = await pageAs('k2viewer')
  const digestHeading = 'มีอะไรเปลี่ยนตั้งแต่คุณเข้ามาครั้งล่าสุด'
  await page.goto(`${BASE_URL}/dashboard/groups/${gid}`)
  await page.getByText(digestHeading).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'รับทราบ' }).click()
  await page.getByText('กดรับทราบครั้งล่าสุด').waitFor({ timeout: 30000 })
  const visit = must(await V.client.from('group_visits').select('last_seen_at').eq('group_id', gid).eq('user_id', V.user.id).single(), 'visit')

  // วัดความต่างของนาฬิกาเครื่องนี้กับเซิร์ฟเวอร์ (last_seen_at มาจากนาฬิกาเบราว์เซอร์ ส่วนเวลา log มาจากเซิร์ฟเวอร์)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } })
  const skewMs = Date.now() - new Date(res.headers.get('date')).getTime()
  await sleep(3000)

  // ชุด B (หลังรับทราบ) 10 เหตุการณ์ 9 ประเภท แต่ละรายการมีข้อความที่ต้องเห็นในสรุป
  const B = [
    [Y, 'comment_added', T(4), { title: 'K2-T4', preview: 'B01' }, 'งาน: K2-T4', 'เขียนบันทึก: B01'],
    [X, 'decision_added', T(5), { title: 'K2-T5', preview: 'B02' }, 'งาน: K2-T5', 'บันทึกการตัดสินใจ: B02'],
    [X, 'task_updated', T(6), { title: 'K2-T6', changes: { deadline: { from: null, to: '2026-11-25T10:00:00Z' } }, reason: 'B03-reason' }, 'งาน: K2-T6', 'เหตุผล: B03-reason'],
    [Y, 'task_declined', T(7), { title: 'K2-T7', reason: 'B04-reason' }, 'งาน: K2-T7', 'ปฏิเสธงาน เหตุผล: B04-reason'],
    [Y, 'task_status_changed', T(8), { title: 'K2-T8', from: 'accepted', to: 'in_progress' }, 'งาน: K2-T8', 'เปลี่ยนสถานะจาก'],
    [X, 'task_created', T(9), { title: 'K2-T9', priority: 'high', deadline: null }, 'งาน: K2-T9', 'สร้างงาน'],
    [X, 'task_assigned', T(10), { title: 'K2-T10', assigned_to: Y.user.id, assignment_type: 'leader_assign' }, 'งาน: K2-T10', 'มอบหมายงานให้'],
    [Y, 'task_claimed', T(11), { title: 'K2-T11' }, 'งาน: K2-T11', 'เลือกรับงานเอง'],
    [Y, 'task_feedback_added', T(12), { title: 'K2-T12' }, 'งาน: K2-T12', 'ส่งฟีดแบคเพื่อนร่วมงาน'],
    [X, 'eval_round_opened', null, { title: 'B10' }, 'เรื่องทั่วไปของกลุ่ม', 'เปิดรอบประเมินเพื่อน "B10"'],
  ]
  for (const [u, action, t, payload] of B) await log(u, gid, action, t ? 'task' : 'group', t ? t.task_id : gid, payload)
  // ตัวควบคุมเชิงลบ: กิจกรรมของผู้ดูเอง ต้องไม่แสดงและไม่ถูกนับ
  await log(V, gid, 'comment_added', 'task', T(13).task_id, { title: 'K2-T13', preview: 'OWN' })
  await sleep(1500)

  // อ่านสรุปในหน้ากลุ่ม
  await page.goto(`${BASE_URL}/dashboard/groups/${gid}`)
  await page.getByText('กดรับทราบครั้งล่าสุด').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  const card = page.getByRole('heading', { name: digestHeading }).locator('xpath=ancestor::div[contains(@class,"bg-white")][1]')
  const topics = await card.evaluate((el) => [...el.querySelectorAll('div.rounded-xl')].map((d) => ({
    title: d.querySelector('p')?.innerText?.trim(),
    items: [...d.querySelectorAll('li')].map((li) => ({ text: li.innerText.trim(), isNew: !!li.querySelector('span.bg-rose-500') })),
  })))
  const allItems = topics.flatMap((t) => t.items.map((i) => ({ ...i, topic: t.title })))

  const checks = []
  const check = (id, desc, pass, detail) => { checks.push({ id, desc, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(6)} ${desc}  [${detail}]`) }
  B.forEach(([, action, , , topic, fragment], i) => {
    const hit = allItems.find((it) => it.topic === topic && it.text.includes(fragment))
    check(`B-${String(i + 1).padStart(2, '0')}`, `${action} แสดงเป็นรายการใหม่`, !!hit && hit.isNew, hit ? `isNew=${hit.isNew}` : 'not shown')
  })
  A.forEach(([, action, , , fragment], i) => {
    const hit = allItems.find((it) => it.text.includes(fragment))
    check(`A-${String(i + 1).padStart(2, '0')}`, `${action} ก่อนรับทราบต้องไม่มีป้ายใหม่`, !hit || !hit.isNew, hit ? `shown, isNew=${hit.isNew}` : 'not shown')
  })
  const own = allItems.find((it) => it.text.includes('OWN'))
  check('OWN', 'กิจกรรมของผู้ดูเองต้องไม่แสดง', !own, own ? 'shown' : 'not shown')
  const newCount = allItems.filter((it) => it.isNew).length
  check('NEW-N', `จำนวนรายการที่มีป้ายใหม่ = ${B.length}`, newCount === B.length, `${newCount}`)

  // จำนวนที่ยังไม่อ่าน: ป้ายบนการ์ดกลุ่มในหน้า dashboard และตัวเลขบน Sidebar
  await page.goto(`${BASE_URL}/dashboard`)
  await page.getByText(`รหัส: ${G.join_code}`).waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const text = await page.locator('body').innerText()
  const cardText = text.slice(text.indexOf(G.group_name))
  const badge = cardText.match(/มี (\d+) การเปลี่ยนแปลงใหม่/)
  check('UNREAD-CARD', `ป้ายบนการ์ดกลุ่ม = ${B.length}`, badge && Number(badge[1]) === B.length, badge ? badge[1] : 'no badge')
  const side = text.match(/แดชบอร์ด\s*\n\s*(\d+|99\+)\s*\n/)
  const sideVal = side ? side[1] : '0'
  check('UNREAD-SIDEBAR', `ตัวเลขบน Sidebar = ${B.length}`, sideVal === String(B.length), sideVal)

  await closeBrowser()
  must(await X.client.rpc('archive_group', { p_group_id: gid }), 'archive G')
  const passed = checks.filter((c) => c.pass).length
  console.log(`\nKPI-2 ${label}: ${passed}/${checks.length} checks passed (clock skew ${skewMs} ms, last_seen_at ${visit.last_seen_at})`)
  if (pilot) return
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi2-round${round}.json`), JSON.stringify({ kpi: 'KPI-2', round, at: nowIso(), commit, group_id: gid, archived_group_id: H.group_id, clockSkewMs: skewMs, lastSeenAt: visit.last_seen_at, passed, total: checks.length, pass: passed === checks.length, checks, topics }, null, 2))
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
