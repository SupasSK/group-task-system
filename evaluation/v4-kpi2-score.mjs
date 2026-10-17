// เกณฑ์ฉบับที่ 4 KPI-2 ความถูกต้องของคะแนนการมีส่วนร่วม
// สร้างกลุ่มตามสถานการณ์ 9 แบบ แล้วเทียบการ์ดคะแนนในแท็บสรุปกับ EXPECTED ซึ่งคิดด้วยมือตามสูตรในเกณฑ์
// (ตารางคำนวณอยู่ใน docs/evaluation/results/v4-kpi2-expected.md และ commit ก่อนรันรอบจริง)
// เกณฑ์: คะแนนรวม และ 4 ส่วนต่างจากค่าที่คิดได้ไม่เกิน 0.5, ส่วนแบ่ง % ตรงกัน ทุกคน
// วิธีรัน: node v4-kpi2-score.mjs <round>   หรือ   node v4-kpi2-score.mjs pilot (ไม่บันทึกผล)
import { signInAs, nowIso } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'
import { roundArg, must, logAs, createGroup, archiveLeftovers, writeResult } from './v4-lib.mjs'

const { pilot, round, label } = roundArg()
const PREFIX = '[TEST] v4 KPI-2'
const PAST = '2026-10-01T10:00:00Z'
const FUTURE = '2026-12-31T10:00:00Z'

// คิดด้วยมือ (v4-kpi2-expected.md): น้ำหนักรวม 28, สมาชิก 4 คน, ส่วนที่ควรได้ F = 7
const EXPECTED = {
  L: { workload: 0, punctual: 0, activityScore: 0, consistency: 15, total: 15, share: 0 },
  A: { workload: 40, punctual: 50 / 3, activityScore: 20, consistency: 15, total: 40 + 50 / 3 + 20 + 15, share: 45 },
  B: { workload: 40 * 5.5 / 7, punctual: 25, activityScore: 12, consistency: 15, total: 40 * 5.5 / 7 + 25 + 12 + 15, share: 20 },
  C: { workload: 40, punctual: 12.5, activityScore: 0, consistency: 15, total: 67.5, share: 36 },
}

function parseCard(text) {
  const n = (re) => { const m = text.match(re); return m ? Number(m[1]) : null }
  return {
    name: text.split('\n')[0].trim(),
    total: n(/(\d+)\s*\/100/),
    workload: n(/ภาระงาน\s*\n?\s*(\d+)\/40/), punctual: n(/ตรงเวลา\s*\n?\s*(\d+)\/25/),
    activityScore: n(/กิจกรรม\s*\n?\s*(\d+)\/20/), consistency: n(/สม่ำเสมอ\s*\n?\s*(\d+)\/15/),
    share: n(/(\d+)% ของกลุ่ม/),
  }
}

async function main() {
  const people = {
    L: await signInAs('k6leader', 'ผู้ทดสอบ หัวหน้า KPI6'),
    A: await signInAs('k6a', 'ผู้ทดสอบ เอ KPI6'),
    B: await signInAs('k6b', 'ผู้ทดสอบ บี KPI6'),
    C: await signInAs('k6c', 'ผู้ทดสอบ ซี KPI6'),
  }
  const { L, A, B, C } = people
  await archiveLeftovers(L, PREFIX)
  const G = await createGroup(L, `${PREFIX} ${label}`, [A, B, C])
  const gid = G.group_id
  const log = (u, action, entityId, payload) => logAs(u, gid, action, 'task', entityId, payload)

  const mk = async (title, priority, difficulty, main, extra = {}) => {
    const t = must(await L.client.from('tasks').insert({ group_id: gid, title, priority, difficulty, headcount: 2, assigned_to: main.user.id, assigned_by: L.user.id, status: 'assigned', assignment_type: 'leader_assign', updated_at: nowIso(), ...extra }).select().single(), title)
    await log(L, 'task_created', t.task_id, { title, priority, deadline: extra.deadline ?? null })
    return t
  }
  const invite = async (t, u, answer) => {
    must(await L.client.from('task_collaborators').insert({ task_id: t.task_id, group_id: gid, user_id: u.user.id, status: 'pending' }), 'invite')
    if (answer) must(await u.client.from('task_collaborators').update({ status: answer, responded_at: nowIso() }).eq('task_id', t.task_id).eq('user_id', u.user.id), 'respond')
  }
  const complete = async (t) => must(await L.client.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() }).eq('task_id', t.task_id), 'complete')

  // สถานการณ์ (เลขในวงเล็บ = สถานการณ์ในเกณฑ์)
  const T1 = await mk('S-T1 ด่วน/ยาก ทำคู่', 'urgent', 'hard', A, { deadline: FUTURE }); await invite(T1, B, 'accepted'); await complete(T1) // (2)
  const T2 = await mk('S-T2 สูง/กลาง เลยกำหนด', 'high', 'medium', A, { deadline: PAST }); await complete(T2) // (1)(6)
  const T3 = await mk('S-T3 ต่ำ/ง่าย ไม่มีกำหนด', 'low', 'easy', B); await complete(T3) // (5)
  const T4 = await mk('S-T4 กลาง/กลาง ผู้ร่วมปฏิเสธ', 'medium', 'medium', C, { deadline: FUTURE }); await invite(T4, A, 'rejected'); await complete(T4) // (3)
  await mk('S-T5 ยังไม่เสร็จ', 'medium', 'hard', B, { status: 'in_progress' }) // (4)
  const T6 = await mk('S-T6 สูง/ยาก ผู้ร่วมยังไม่ตอบ เลยกำหนด', 'high', 'hard', C, { deadline: PAST }); await invite(T6, B, null); await complete(T6) // (3)(6)
  const T9 = await mk('S-T9 กลาง ไม่ระบุความยาก', 'medium', null, A, { deadline: FUTURE }); await complete(T9) // (5)
  // กิจกรรม: A ความเห็น 7 ครั้งในวันเดียว นับได้ 5 (8); B การตัดสินใจ 2 + แก้ลิงก์ผลงาน 1; C แก้งานที่ไม่ใช่ลิงก์ 1 (ไม่นับ)
  for (let i = 1; i <= 7; i++) await log(A, 'comment_added', T1.task_id, { title: T1.title, preview: `A${i}` })
  for (let i = 1; i <= 2; i++) await log(B, 'decision_added', T3.task_id, { title: T3.title, preview: `B${i}` })
  await log(B, 'task_updated', T3.task_id, { title: T3.title, changes: { work_url: { from: null, to: 'https://example.com/work' } } })
  await log(C, 'task_updated', T4.task_id, { title: T4.title, changes: { description: { from: null, to: 'x' } } })
  // A และ C ทำเกินส่วนที่ควรได้ (7), L ไม่มีงานและไม่มีกิจกรรมที่นับ (9)

  const fixtureDifficultyT9 = (await L.client.from('tasks').select('difficulty').eq('task_id', T9.task_id).single()).data?.difficulty ?? null

  const page = await pageAs('k6leader')
  await page.goto(`${BASE_URL}/dashboard/groups/${gid}?tab=summary`)
  await page.getByText('คะแนนการมีส่วนร่วม (เต็ม 100)').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const measuredAt = nowIso()
  const cards = await page.getByText('คะแนนการมีส่วนร่วม (เต็ม 100)').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]')
    .evaluate((el) => [...el.querySelectorAll('div.rounded-xl.bg-slate-50')].map((d) => d.innerText))
  await closeBrowser()

  const results = []
  for (const [key, exp] of Object.entries(EXPECTED)) {
    const fullName = (await L.client.from('users').select('full_name').eq('user_id', people[key].user.id).single()).data?.full_name
    const card = cards.map(parseCard).find((c) => c.name === fullName)
    const checks = []
    if (!card) checks.push({ field: 'card', expected: fullName, shown: null, pass: false })
    else {
      for (const f of ['total', 'workload', 'punctual', 'activityScore', 'consistency']) {
        checks.push({ field: f, expected: Number(exp[f].toFixed(3)), shown: card[f], pass: card[f] !== null && Math.abs(card[f] - exp[f]) <= 0.5 })
      }
      checks.push({ field: 'share', expected: exp.share, shown: card.share, pass: card.share === exp.share })
    }
    const bad = checks.filter((c) => !c.pass)
    results.push({ member: key, name: fullName, pass: bad.length === 0, checks })
    console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'} ${key} ${String(fullName).padEnd(22)} ${bad.length ? JSON.stringify(bad) : `${checks.length}/${checks.length} ค่า`}`)
  }
  must(await L.client.rpc('archive_group', { p_group_id: gid }), 'archive')
  const passed = results.filter((r) => r.pass).length
  const pass = passed === results.length
  console.log(`\nKPI-2 ${label}: ${passed}/${results.length} คน → ${pass ? 'ผ่าน' : 'ไม่ผ่าน'} (T9 difficulty ในฐานข้อมูล = ${fixtureDifficultyT9})`)
  if (pilot) return
  writeResult(`v4-kpi2-round${round}.json`, { kpi: 'KPI-2', round, baseUrl: BASE_URL, group_id: gid, measuredAt, fixtureDifficultyT9, expected: EXPECTED, passed, total: results.length, pass, results, rawCards: cards })
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
