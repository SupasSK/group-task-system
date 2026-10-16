// KPI-1 ความถูกต้องของความคืบหน้า: เปลี่ยนสถานะงานทีละครั้ง แล้วเทียบค่าที่หน้าเว็บแสดงกับค่าจริงจากตาราง tasks
// วิธีรัน: node kpi1-progress.mjs <round>   หรือ   node kpi1-progress.mjs pilot (ทดลองเครื่องมือ 2 จุดตรวจ ไม่บันทึกผล)
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, nowIso, ROOT } from './lib.mjs'
import { pageAs, textOf, closeBrowser } from './browser.mjs'

const arg = process.argv[2] || 'pilot'
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const must = (res, what) => { if (res.error) throw new Error(`fixture: ${what}: ${res.error.message}`); return res.data }

const PAST = '2026-10-01T10:00:00Z'
const FUTURE = '2026-12-31T10:00:00Z'
const STATUSES = ['accepted', 'in_progress', 'completed', 'rejected', 'pending', 'assigned']

// ---------- ค่าจริง (คำนวณจากแถวในตาราง tasks ตามนิยามในเกณฑ์ฉบับที่ 2) ----------
const pct = (ts) => (ts.length === 0 ? 0 : Math.round((ts.filter((t) => t.status === 'completed').length / ts.length) * 100))
const isDoing = (t) => t.status === 'accepted' || t.status === 'in_progress'
const isOverdue = (t, now) => !!t.deadline && new Date(t.deadline) < now && t.status !== 'completed' && t.status !== 'rejected'

function truth(tasks, groups, memberId) {
  const now = new Date()
  const byGroup = Object.fromEntries(groups.map((g) => [g.group_id, tasks.filter((t) => t.group_id === g.group_id)]))
  const exp = {}
  exp['dashboard.groups'] = groups.length
  exp['dashboard.total'] = tasks.length
  exp['dashboard.doing'] = tasks.filter(isDoing).length
  exp['dashboard.done'] = tasks.filter((t) => t.status === 'completed').length
  exp['dashboard.overdue'] = tasks.filter((t) => isOverdue(t, now)).length
  for (const g of groups) {
    const ts = byGroup[g.group_id]
    const done = ts.filter((t) => t.status === 'completed').length
    exp[`dashboard.${g.key}.progress`] = pct(ts)
    exp[`leader.${g.key}.progress`] = pct(ts)
    exp[`leader.${g.key}.total`] = ts.length
    exp[`leader.${g.key}.todo`] = ts.filter((t) => t.status !== 'completed' && !isDoing(t)).length
    exp[`leader.${g.key}.doing`] = ts.filter(isDoing).length
    exp[`leader.${g.key}.done`] = done
    exp[`group.${g.key}.progress`] = pct(ts)
    exp[`group.${g.key}.done`] = done
    exp[`group.${g.key}.total`] = ts.length
  }
  const open = (t) => t.status !== 'completed' && t.status !== 'rejected'
  exp['member.mine'] = tasks.filter((t) => t.assigned_to === memberId && open(t)).length
  exp['member.open'] = tasks.filter((t) => t.assignment_type === 'open_choice' && open(t) && t.assigned_to !== memberId
    && ((!t.assigned_to && t.status === 'pending') || 0 < (t.headcount ?? 1) - 1)).length
  exp['member.completed'] = tasks.filter((t) => t.assigned_to === memberId && t.status === 'completed').length
  return exp
}

// ---------- อ่านค่าจากข้อความบนหน้าเว็บ ----------
const num = (text, re) => { const m = text.match(re); return m ? Number(m[1]) : null }
function section(text, start, marker, allMarkers) {
  const i = text.indexOf(marker, start)
  if (i < 0) return ''
  const ends = allMarkers.map((m) => text.indexOf(m, i + marker.length)).filter((j) => j > i)
  return text.slice(i, ends.length ? Math.min(...ends) : undefined)
}

async function readPages(lp, mp, groups) {
  const got = {}
  const codes = groups.map((g) => `รหัส: ${g.join_code}`)
  let t = await textOf(lp, '/dashboard', codes[groups.length - 1])
  got['dashboard.groups'] = num(t, /(\d+)\s*\n\s*กลุ่มทั้งหมด/)
  got['dashboard.total'] = num(t, /(\d+)\s*\n\s*งานทั้งหมด/)
  got['dashboard.doing'] = num(t, /(\d+)\s*\n\s*กำลังดำเนินการ/)
  got['dashboard.done'] = num(t, /(\d+)\s*\n\s*เสร็จสิ้น/)
  got['dashboard.overdue'] = num(t, /(\d+)\s*\n\s*เลยกำหนด/)
  for (const g of groups) got[`dashboard.${g.key}.progress`] = num(section(t, 0, `รหัส: ${g.join_code}`, codes), /ความคืบหน้า\s*\n?\s*(\d+)%/)

  t = await textOf(lp, '/dashboard/leader', 'ภาพรวมโครงการที่คุณดูแล')
  const start = t.indexOf('ภาพรวมโครงการที่คุณดูแล')
  const names = groups.map((g) => g.group_name)
  for (const g of groups) {
    const s = section(t, start, g.group_name, names)
    got[`leader.${g.key}.progress`] = num(s, /ความคืบหน้า\s*\n?\s*(\d+)%/)
    got[`leader.${g.key}.total`] = num(s, /(\d+) งานทั้งหมด/)
    got[`leader.${g.key}.todo`] = num(s, /รอเริ่ม\s*\n\s*(\d+)\s*\n/)
    got[`leader.${g.key}.doing`] = num(s, /กำลังทำ\s*\n\s*(\d+)\s*\n/)
    got[`leader.${g.key}.done`] = num(s, /เสร็จแล้ว\s*\n\s*(\d+)\s*(\n|$)/)
  }

  for (const g of groups) {
    t = await textOf(lp, `/dashboard/groups/${g.group_id}`, 'ความคืบหน้าของโครงการ')
    got[`group.${g.key}.progress`] = num(t, /ความคืบหน้าของโครงการ\s*\n?\s*(\d+)%/)
    got[`group.${g.key}.done`] = num(t, /เสร็จแล้ว (\d+) จาก \d+ งาน/)
    got[`group.${g.key}.total`] = num(t, /เสร็จแล้ว \d+ จาก (\d+) งาน/)
  }

  t = await textOf(mp, '/dashboard/member', 'งานที่คุณทำสำเร็จแล้ว')
  got['member.mine'] = num(t, /งานที่คุณกำลังทำ \/ ถืออยู่\s*\n\s*(\d+) งาน/)
  got['member.open'] = num(t, /งานว่างที่รอคนเลือกรับ\s*\n\s*(\d+) งาน/)
  got['member.completed'] = num(t, /งานที่คุณทำสำเร็จแล้ว\s*\n\s*(\d+) งาน/)
  return got
}

async function main() {
  // บัญชีเฉพาะของ KPI-1 เพื่อไม่ให้กลุ่มทดสอบอื่นปนในหน้า dashboard
  const L = await signInAs('k1leader', 'ผู้ทดสอบ หัวหน้า KPI1')
  const M = await signInAs('k1member', 'ผู้ทดสอบ สมาชิก KPI1')
  const M2 = await signInAs('k1member2', 'ผู้ทดสอบ สมาชิกสอง KPI1')

  // กลุ่มทดสอบเก่าที่ยังไม่ถูกเก็บ (เช่นรันค้าง) เก็บเข้าคลังก่อน
  const { data: old } = await L.client.from('groups').select('group_id').eq('created_by', L.user.id).is('archived_at', null)
  for (const g of old || []) await L.client.rpc('archive_group', { p_group_id: g.group_id })

  // 3 กลุ่ม งานรวม 15 งาน (6 + 5 + 4)
  const label = pilot ? 'pilot' : `r${round}`
  const groups = []
  for (const [key, n] of [['G1', 6], ['G2', 5], ['G3', 4]]) {
    const join_code = code6()
    const g = must(await L.client.from('groups').insert({ group_name: `[TEST] KPI-1 ${key} ${label}`, work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
    must(await L.client.from('group_members').insert({ group_id: g.group_id, user_id: L.user.id, role: 'leader' }), 'leader')
    for (const u of [M, M2]) must(await u.client.rpc('join_group_by_code', { p_code: join_code }), 'join')
    groups.push({ ...g, key, n })
  }
  const tasks = []
  let k = 0
  for (const g of groups) {
    for (let i = 0; i < g.n; i++, k++) {
      const open = k % 3 === 2
      const row = {
        group_id: g.group_id, title: `${g.key}-T${i + 1}`, priority: 'medium', difficulty: 'medium', headcount: 1,
        assigned_by: L.user.id, updated_at: nowIso(),
        assignment_type: open ? 'open_choice' : 'leader_assign',
        assigned_to: open ? null : (k % 2 === 0 ? M.user.id : M2.user.id),
        status: open ? 'pending' : 'assigned',
        deadline: [PAST, FUTURE, null][k % 3],
      }
      tasks.push(must(await L.client.from('tasks').insert(row).select().single(), 'task'))
    }
  }

  // ลำดับการเปลี่ยนสถานะตายตัว 30 ครั้ง ครอบคลุมทั้ง 6 สถานะ (หัวหน้าเป็นผู้เปลี่ยน)
  const steps = Array.from({ length: pilot ? 1 : 30 }, (_, s) => ({ task: tasks[(s * 7) % tasks.length], status: STATUSES[s % 6] }))

  const lp = await pageAs('k1leader')
  const mp = await pageAs('k1member')
  const checkpoints = []
  for (let c = 0; c <= steps.length; c++) {
    let change = 'สถานะเริ่มต้น'
    if (c > 0) {
      const { task, status } = steps[c - 1]
      must(await L.client.from('tasks').update({ status, updated_at: nowIso(), completed_at: status === 'completed' ? nowIso() : null }).eq('task_id', task.task_id), 'transition')
      change = `${task.title} -> ${status}`
    }
    const rows = must(await L.client.from('tasks').select('*').in('group_id', groups.map((g) => g.group_id)), 'read tasks')
    const exp = truth(rows, groups, M.user.id)
    const got = await readPages(lp, mp, groups)
    const mismatches = Object.keys(exp).filter((key) => got[key] !== exp[key]).map((key) => ({ key, expected: exp[key], shown: got[key] }))
    checkpoints.push({ checkpoint: c, change, values: Object.keys(exp).length, pass: mismatches.length === 0, mismatches })
    console.log(`${mismatches.length === 0 ? 'PASS' : 'FAIL'} #${String(c).padStart(2)} ${change.padEnd(22)} ${Object.keys(exp).length - mismatches.length}/${Object.keys(exp).length}${mismatches.length ? '  ' + JSON.stringify(mismatches) : ''}`)
  }
  await closeBrowser()
  for (const g of groups) await L.client.rpc('archive_group', { p_group_id: g.group_id })

  const values = checkpoints.reduce((s, c) => s + c.values, 0)
  const matched = checkpoints.reduce((s, c) => s + c.values - c.mismatches.length, 0)
  const statusesCovered = [...new Set(steps.map((s) => s.status))]
  console.log(`\nKPI-1 ${label}: ${matched}/${values} values matched over ${checkpoints.length} checkpoints; statuses covered: ${statusesCovered.join(', ')}`)
  if (pilot) return
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi1-round${round}.json`), JSON.stringify({ kpi: 'KPI-1', round, at: nowIso(), commit, groups: groups.map((g) => g.group_id), tasks: tasks.length, transitions: steps.length, statusesCovered, matched, values, pass: matched === values, checkpoints }, null, 2))
}

main().catch(async (e) => { console.error(e.message); await closeBrowser(); process.exit(1) })
