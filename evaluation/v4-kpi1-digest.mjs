// เกณฑ์ฉบับที่ 4 KPI-1 สรุปสิ่งที่พลาดไป (Catch-up Digest)
// สมาชิกคนอื่นทำกิจกรรม 3 รายการ → ผู้ดูกด "รับทราบ" ผ่านหน้าเว็บ → สมาชิกคนอื่นทำกิจกรรม 10 รายการหลายประเภท
// → ผู้ดูเปิดหน้ากลุ่ม แล้วนับรายการที่มีป้าย "ใหม่"
// เกณฑ์: 10 รายการหลังรับทราบมีป้าย "ใหม่" 10/10 และ 3 รายการก่อนรับทราบมีป้าย 0/3
// วิธีรัน: node v4-kpi1-digest.mjs <round>   หรือ   node v4-kpi1-digest.mjs pilot (ไม่บันทึกผล)
import { signInAs, nowIso, SUPABASE_URL, ANON_KEY } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'
import { roundArg, must, sleep, logAs, createGroup, archiveLeftovers, writeResult } from './v4-lib.mjs'

const { pilot, round, label } = roundArg()
const PREFIX = '[TEST] v4 KPI-1'
const DIGEST = 'มีอะไรเปลี่ยนตั้งแต่คุณเข้ามาครั้งล่าสุด'

async function main() {
  const X = await signInAs('k2leader', 'ผู้ทดสอบ หัวหน้า KPI2')
  const Y = await signInAs('k2member', 'ผู้ทดสอบ สมาชิก KPI2')
  const V = await signInAs('k2viewer', 'ผู้ทดสอบ ผู้ดู KPI2')
  await archiveLeftovers(X, PREFIX)

  const G = await createGroup(X, `${PREFIX} ${label}`, [Y, V])
  const gid = G.group_id
  const tasks = []
  for (let i = 1; i <= 13; i++) {
    tasks.push(must(await X.client.from('tasks').insert({ group_id: gid, title: `D-T${i}`, priority: 'medium', status: 'pending', assignment_type: 'open_choice', assigned_by: X.user.id, updated_at: nowIso() }).select().single(), 'task'))
  }
  const T = (i) => tasks[i - 1]

  // ก่อนรับทราบ 3 รายการ: [ผู้ทำ, action, งาน, payload, ข้อความที่ใช้ค้นหาในสรุป]
  const before = [
    [Y, 'comment_added', T(1), { title: 'D-T1', preview: 'PRE01' }, 'PRE01'],
    [X, 'decision_added', T(2), { title: 'D-T2', preview: 'PRE02' }, 'PRE02'],
    [Y, 'comment_added', T(3), { title: 'D-T3', preview: 'PRE03' }, 'PRE03'],
  ]
  for (const [u, action, t, payload] of before) await logAs(u, gid, action, 'task', t.task_id, payload)

  await sleep(2000)
  const page = await pageAs('k2viewer')
  await page.goto(`${BASE_URL}/dashboard/groups/${gid}`)
  await page.getByText(DIGEST).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'รับทราบ' }).click()
  await page.getByText('กดรับทราบครั้งล่าสุด').waitFor({ timeout: 30000 })
  const visit = must(await V.client.from('group_visits').select('last_seen_at').eq('group_id', gid).eq('user_id', V.user.id).single(), 'visit')
  // last_seen_at มาจากนาฬิกาเบราว์เซอร์ ส่วนเวลา log มาจากเซิร์ฟเวอร์ บันทึกความต่างไว้ประกอบผล
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: ANON_KEY } })
  const clockSkewMs = Date.now() - new Date(res.headers.get('date')).getTime()
  await sleep(3000)

  // หลังรับทราบ 10 รายการ 10 ประเภท: [ผู้ทำ, action, งาน|null, payload, หัวข้อในสรุป, ข้อความที่ต้องพบ]
  const after = [
    [Y, 'comment_added', T(4), { title: 'D-T4', preview: 'NEW01' }, 'งาน: D-T4', 'NEW01'],
    [X, 'decision_added', T(5), { title: 'D-T5', preview: 'NEW02' }, 'งาน: D-T5', 'NEW02'],
    [X, 'task_updated', T(6), { title: 'D-T6', changes: { deadline: { from: null, to: '2026-12-25T10:00:00Z' } }, reason: 'NEW03' }, 'งาน: D-T6', 'NEW03'],
    [Y, 'task_declined', T(7), { title: 'D-T7', reason: 'NEW04' }, 'งาน: D-T7', 'NEW04'],
    [Y, 'task_status_changed', T(8), { title: 'D-T8', from: 'accepted', to: 'in_progress' }, 'งาน: D-T8', 'เปลี่ยนสถานะจาก'],
    [X, 'task_created', T(9), { title: 'D-T9', priority: 'high', deadline: null }, 'งาน: D-T9', 'สร้างงาน'],
    [X, 'task_assigned', T(10), { title: 'D-T10', assigned_to: Y.user.id, assignment_type: 'leader_assign' }, 'งาน: D-T10', 'มอบหมายงานให้'],
    [Y, 'task_claimed', T(11), { title: 'D-T11' }, 'งาน: D-T11', 'เลือกรับงานเอง'],
    [Y, 'task_accepted', T(12), { title: 'D-T12' }, 'งาน: D-T12', 'รับงาน'],
    [X, 'eval_round_opened', null, { title: 'NEW10' }, 'เรื่องทั่วไปของกลุ่ม', 'NEW10'],
  ]
  for (const [u, action, t, payload] of after) await logAs(u, gid, action, t ? 'task' : 'group', t ? t.task_id : gid, payload)
  await sleep(1500)

  await page.goto(`${BASE_URL}/dashboard/groups/${gid}`)
  await page.getByText('กดรับทราบครั้งล่าสุด').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  const card = page.getByRole('heading', { name: DIGEST }).locator('xpath=ancestor::div[contains(@class,"bg-white")][1]')
  const topics = await card.evaluate((el) => [...el.querySelectorAll('div.rounded-xl')].map((d) => ({
    title: d.querySelector('p')?.innerText?.trim(),
    items: [...d.querySelectorAll('li')].map((li) => ({ text: li.innerText.trim(), isNew: [...li.querySelectorAll('span')].some((s) => s.innerText.trim() === 'ใหม่') })),
  })))
  await closeBrowser()
  const items = topics.flatMap((t) => t.items.map((i) => ({ ...i, topic: t.title })))

  const checks = []
  const check = (id, desc, pass, detail) => { checks.push({ id, desc, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id.padEnd(7)} ${desc}  [${detail}]`) }
  after.forEach(([, action, , , topic, fragment], i) => {
    const hit = items.find((it) => it.topic === topic && it.text.includes(fragment))
    check(`NEW-${String(i + 1).padStart(2, '0')}`, `${action} หลังรับทราบมีป้าย "ใหม่"`, !!hit && hit.isNew, hit ? `isNew=${hit.isNew}` : 'ไม่แสดง')
  })
  before.forEach(([, action, , , fragment], i) => {
    const hit = items.find((it) => it.text.includes(fragment))
    check(`PRE-${String(i + 1).padStart(2, '0')}`, `${action} ก่อนรับทราบไม่มีป้าย "ใหม่"`, !hit || !hit.isNew, hit ? `แสดง, isNew=${hit.isNew}` : 'ไม่แสดง')
  })
  const newShown = checks.filter((c) => c.id.startsWith('NEW') && c.pass).length
  const preFlagged = checks.filter((c) => c.id.startsWith('PRE') && !c.pass).length
  const pass = newShown === after.length && preFlagged === 0
  must(await X.client.rpc('archive_group', { p_group_id: gid }), 'archive')
  console.log(`\nKPI-1 ${label}: ใหม่ ${newShown}/${after.length}, ก่อนรับทราบที่มีป้าย ${preFlagged}/${before.length} → ${pass ? 'ผ่าน' : 'ไม่ผ่าน'} (clock skew ${clockSkewMs} ms)`)
  if (pilot) return
  writeResult(`v4-kpi1-round${round}.json`, { kpi: 'KPI-1', round, baseUrl: BASE_URL, group_id: gid, lastSeenAt: visit.last_seen_at, clockSkewMs, newShown, preFlagged, pass, checks, topics })
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
