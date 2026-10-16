// KPI-6 ความถูกต้องของคะแนนการมีส่วนร่วม: สร้างชุดข้อมูลตายตัว คำนวณคะแนนตาม docs/evaluation/results/kpi6-formula.md
// แล้วเทียบกับการ์ดคะแนนในแท็บสรุปของหน้ากลุ่ม
// วิธีรัน: node kpi6-participation.mjs <round>   หรือ   node kpi6-participation.mjs pilot
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, nowIso, ROOT } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'

const arg = process.argv[2] || 'pilot'
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
const label = pilot ? 'pilot' : `r${round}`
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const must = (res, what) => { if (res.error) throw new Error(`fixture: ${what}: ${res.error.message}`); return res.data }
const PAST = '2026-10-01T10:00:00Z'
const FUTURE = '2026-12-31T10:00:00Z'
const WEEK = 7 * 24 * 60 * 60 * 1000

// ---------- สูตรอิสระ (kpi6-formula.md) ----------
const P = { low: 1, medium: 2, high: 3, urgent: 4 }
const D = { easy: 1, medium: 2, hard: 3 }
const weight = (t) => (P[t.priority] ?? 2) + (D[t.difficulty ?? 'medium'] ?? 2)
const COUNTED = (l) => l.action_type === 'comment_added' || l.action_type === 'decision_added'
  || (l.action_type === 'task_updated' && !!l.payload?.changes?.work_url)
const bangkokDay = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)

function expected(members, tasks, collabs, responses, logs, joined, now) {
  const team = (t) => [...(t.assigned_to ? [t.assigned_to] : []), ...collabs.filter((c) => c.task_id === t.task_id && c.status === 'accepted').map((c) => c.user_id)]
  const done = tasks.filter((t) => t.status === 'completed').map((t) => ({ t, team: team(t) })).filter((x) => x.team.length > 0)
  const totalPoints = done.reduce((s, x) => s + weight(x.t), 0)
  const fairShare = totalPoints / members.length
  const raw = members.map((m) => {
    const mine = done.filter((x) => x.team.includes(m.user_id))
    const points = mine.reduce((s, x) => s + weight(x.t) / x.team.length, 0)
    const onTime = mine.filter((x) => !x.t.deadline || (x.t.completed_at && new Date(x.t.completed_at) <= new Date(x.t.deadline))).length
    const rejected = responses.filter((r) => r.user_id === m.user_id && r.response === 'rejected').length
    const myLogs = logs.filter((l) => l.actor_id === m.user_id)
    const perDay = {}
    for (const l of myLogs.filter(COUNTED)) perDay[bangkokDay(l.created_at)] = Math.min(5, (perDay[bangkokDay(l.created_at)] ?? 0) + 1)
    const activity = Object.values(perDay).reduce((s, n) => s + n, 0)
    const start = new Date(joined[m.user_id]).getTime()
    const totalWeeks = Math.max(1, Math.floor((now - start) / WEEK) + 1)
    const activeWeeks = new Set(myLogs.map((l) => Math.max(0, Math.floor((new Date(l.created_at).getTime() - start) / WEEK)))).size
    return { m, doneCount: mine.length, points, onTime, rejected, activity, activeWeeks, totalWeeks }
  })
  const maxActivity = Math.max(...raw.map((r) => r.activity))
  return raw.map((r) => {
    const workload = fairShare > 0 ? 40 * Math.min(1, r.points / fairShare) : 0
    const punctual = r.doneCount > 0 ? (25 * r.onTime) / r.doneCount : 0
    const activityScore = maxActivity > 0 ? (20 * r.activity) / maxActivity : 0
    const consistency = 15 * Math.min(1, r.activeWeeks / r.totalWeeks)
    return {
      name: r.m.full_name, total: workload + punctual + activityScore + consistency,
      workload, punctual, activityScore, consistency,
      doneCount: r.doneCount, share: totalPoints > 0 ? Math.round((r.points / totalPoints) * 100) : 0,
      onTime: r.onTime, rejected: r.rejected, activity: r.activity, activeWeeks: r.activeWeeks, totalWeeks: r.totalWeeks,
    }
  })
}

// ---------- อ่านการ์ดคะแนน ----------
function parseCard(text) {
  const n = (re) => { const m = text.match(re); return m ? Number(m[1]) : null }
  return {
    name: text.split('\n')[0].trim(),
    total: n(/(\d+)\s*\/100/),
    workload: n(/ภาระงาน\s*\n?\s*(\d+)\/40/), punctual: n(/ตรงเวลา\s*\n?\s*(\d+)\/25/),
    activityScore: n(/กิจกรรม\s*\n?\s*(\d+)\/20/), consistency: n(/สม่ำเสมอ\s*\n?\s*(\d+)\/15/),
    doneCount: n(/เสร็จ (\d+) งาน/), share: n(/(\d+)% ของกลุ่ม/), onTime: n(/ทันกำหนด (\d+)\/\d+/),
    rejected: n(/ปฏิเสธ (\d+)/), activity: n(/กิจกรรม (\d+) ครั้ง/),
    activeWeeks: n(/มีกิจกรรม (\d+)\/\d+ สัปดาห์/), totalWeeks: n(/มีกิจกรรม \d+\/(\d+) สัปดาห์/),
  }
}

async function main() {
  const L = await signInAs('k6leader', 'ผู้ทดสอบ หัวหน้า KPI6')
  const A = await signInAs('k6a', 'ผู้ทดสอบ เอ KPI6')
  const B = await signInAs('k6b', 'ผู้ทดสอบ บี KPI6')
  const C = await signInAs('k6c', 'ผู้ทดสอบ ซี KPI6')
  const { data: old } = await L.client.from('groups').select('group_id').eq('created_by', L.user.id).is('archived_at', null)
  for (const g of old || []) await L.client.rpc('archive_group', { p_group_id: g.group_id })

  const join_code = code6()
  const G = must(await L.client.from('groups').insert({ group_name: `[TEST] KPI-6 ${label}`, work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
  const gid = G.group_id
  must(await L.client.from('group_members').insert({ group_id: gid, user_id: L.user.id, role: 'leader' }), 'leader')
  for (const u of [A, B, C]) must(await u.client.rpc('join_group_by_code', { p_code: join_code }), 'join')
  const log = async (u, action, entityId, payload) => must(await u.client.rpc('log_activity', { p_group_id: gid, p_action_type: action, p_entity_type: 'task', p_entity_id: entityId, p_payload: payload }), `log ${action}`)

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

  // ชุดข้อมูลตายตัว
  const T1 = await mk('K6-T1 ด่วน/ยาก ทำคู่', 'urgent', 'hard', A, { deadline: FUTURE }); await invite(T1, B, 'accepted'); await complete(T1)
  const T2 = await mk('K6-T2 สูง/กลาง เลยกำหนด', 'high', 'medium', A, { deadline: PAST }); await complete(T2)
  const T3 = await mk('K6-T3 ต่ำ/ง่าย ไม่มีกำหนด', 'low', 'easy', B); await complete(T3)
  const T4 = await mk('K6-T4 กลาง/กลาง ผู้ร่วมปฏิเสธ', 'medium', 'medium', C, { deadline: FUTURE }); await invite(T4, A, 'rejected'); await complete(T4)
  await mk('K6-T5 ยังไม่เสร็จ', 'medium', 'hard', B, { status: 'in_progress' })
  const T6 = await mk('K6-T6 สูง/ยาก ผู้ร่วมยังไม่ตอบ', 'high', 'hard', C, { deadline: PAST }); await invite(T6, B, null); await complete(T6)
  const T7 = await mk('K6-T7 A ปฏิเสธ', 'low', 'medium', A)
  must(await A.client.from('task_responses').insert({ task_id: T7.task_id, user_id: A.user.id, response: 'rejected' }), 'reject A')
  const T8 = await mk('K6-T8 C ปฏิเสธ', 'low', 'medium', C)
  must(await C.client.from('task_responses').insert({ task_id: T8.task_id, user_id: C.user.id, response: 'rejected' }), 'reject C')
  // กิจกรรม: A ความเห็น 7 ครั้งในวันเดียว (นับได้ 5), B การตัดสินใจ 2 + แก้ลิงก์ผลงาน 1, C แก้งานที่ไม่ใช่ลิงก์ 1 (ไม่นับ)
  for (let i = 1; i <= 7; i++) await log(A, 'comment_added', T1.task_id, { title: T1.title, preview: `A${i}` })
  for (let i = 1; i <= 2; i++) await log(B, 'decision_added', T3.task_id, { title: T3.title, preview: `B${i}` })
  await log(B, 'task_updated', T3.task_id, { title: T3.title, changes: { work_url: { from: null, to: 'https://example.com/work' } } })
  await log(C, 'task_updated', T4.task_id, { title: T4.title, changes: { description: { from: null, to: 'x' } } })

  // ข้อมูลดิบสำหรับสูตรอิสระ
  const people = [L, A, B, C]
  const users = must(await L.client.from('users').select('user_id, full_name').in('user_id', people.map((p) => p.user.id)), 'users')
  const members = people.map((p) => users.find((u) => u.user_id === p.user.id))
  const tasks = must(await L.client.from('tasks').select('*').eq('group_id', gid), 'tasks')
  const collabs = must(await L.client.from('task_collaborators').select('task_id, user_id, status').eq('group_id', gid), 'collabs')
  const responses = must(await L.client.from('task_responses').select('user_id, response').in('task_id', tasks.map((t) => t.task_id)), 'responses')
  const logs = must(await L.client.from('activity_logs').select('actor_id, action_type, payload, created_at').eq('group_id', gid), 'logs')
  const gm = must(await L.client.from('group_members').select('user_id, joined_at').eq('group_id', gid), 'members')
  const joined = Object.fromEntries(gm.map((m) => [m.user_id, m.joined_at]))

  // เปิดแท็บสรุปในฐานะหัวหน้า
  const page = await pageAs('k6leader')
  await page.goto(`${BASE_URL}/dashboard/groups/${gid}?tab=summary`)
  await page.getByText('คะแนนการมีส่วนร่วม (เต็ม 100)').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const loadedAt = Date.now()
  const cards = await page.getByText('คะแนนการมีส่วนร่วม (เต็ม 100)').locator('xpath=ancestor::div[contains(@class,"bg-white")][1]')
    .evaluate((el) => [...el.querySelectorAll('div.rounded-xl.bg-slate-50')].map((d) => d.innerText))
  await closeBrowser()

  const exp = expected(members, tasks, collabs, responses, logs, joined, loadedAt)
  const results = []
  for (const e of exp) {
    const card = cards.map(parseCard).find((c) => c.name === e.name)
    const checks = []
    if (!card) checks.push({ field: 'card', expected: e.name, shown: null, pass: false })
    else {
      checks.push({ field: 'total', expected: Number(e.total.toFixed(3)), shown: card.total, pass: card.total !== null && Math.abs(card.total - e.total) <= 0.5 })
      for (const f of ['workload', 'punctual', 'activityScore', 'consistency']) checks.push({ field: f, expected: Math.round(e[f]), shown: card[f], pass: card[f] === Math.round(e[f]) })
      for (const f of ['doneCount', 'share', 'onTime', 'rejected', 'activity', 'activeWeeks', 'totalWeeks']) checks.push({ field: f, expected: e[f], shown: card[f], pass: card[f] === e[f] })
    }
    const bad = checks.filter((c) => !c.pass)
    results.push({ name: e.name, exactTotal: e.total, pass: bad.length === 0, checks })
    console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'} ${e.name.padEnd(22)} total exact ${e.total.toFixed(2).padStart(6)} shown ${card?.total ?? '-'}  ${bad.length ? JSON.stringify(bad) : `${checks.length}/${checks.length} values`}`)
  }
  must(await L.client.rpc('archive_group', { p_group_id: gid }), 'archive')
  const passed = results.filter((r) => r.pass).length
  console.log(`\nKPI-6 ${label}: ${passed}/${results.length} members passed`)
  if (pilot) return
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi6-round${round}.json`), JSON.stringify({ kpi: 'KPI-6', round, at: nowIso(), commit, group_id: gid, passed, total: results.length, pass: passed === results.length, results, rawCards: cards }, null, 2))
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
