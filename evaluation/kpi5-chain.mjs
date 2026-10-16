// KPI-5 การตรวจจับการแก้ไขประวัติกิจกรรม (และ A09 ของ KPI-9 เกณฑ์ข้อ 5)
// ขั้นที่ 1: node kpi5-chain.mjs setup <round>  สร้าง 4 กลุ่มทดสอบ (control / edit / delete / insert) กลุ่มละ 14 log
//            ตรวจว่าทุกกลุ่มสมบูรณ์ก่อนแก้ (ตัวควบคุม) แล้วสร้างไฟล์ SQL สำหรับผู้วิจัยรันใน SQL Editor
// ขั้นที่ 2: ผู้วิจัยรัน docs/evaluation/results/kpi5-round<round>-tamper.sql (แก้ log 3 แบบ แล้วรัน run_integrity_checks)
// ขั้นที่ 3: node kpi5-chain.mjs check <round>  ตรวจผลผ่าน RPC, ปุ่มตรวจในหน้าเว็บ และแถบเตือนของ A09
// แต่ละแบบใช้กลุ่มแยก เพราะเมื่อสายบันทึกเสียแล้ว การแก้ครั้งต่อไปในกลุ่มเดียวกันจะแยกตรวจไม่ได้
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { signInAs, nowIso, ROOT } from './lib.mjs'
import { pageAs, closeBrowser, BASE_URL } from './browser.mjs'

const [phase, roundArg] = process.argv.slice(2)
const round = Number(roundArg)
if (!['setup', 'check'].includes(phase) || !round) throw new Error('ใช้: node kpi5-chain.mjs setup|check <round>')
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }
const dir = join(ROOT, 'docs', 'evaluation', 'results')
const stateFile = join(dir, `kpi5-round${round}-setup.json`)
const KINDS = ['control', 'edit', 'delete', 'insert']
const nameOf = (kind) => `[TEST] KPI-5 ${kind} r${round}`

async function verify(client, gid) {
  const row = must(await client.rpc('verify_activity_chain', { p_group_id: gid }), 'verify')[0]
  return { is_valid: row.is_valid, broken_at_seq: row.broken_at_seq }
}

async function setup(L, M) {
  const groups = {}
  for (const kind of KINDS) {
    const join_code = code6()
    const g = must(await L.client.from('groups').insert({ group_name: nameOf(kind), work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
    must(await L.client.from('group_members').insert({ group_id: g.group_id, user_id: L.user.id, role: 'leader' }), 'leader')
    must(await L.client.rpc('log_activity', { p_group_id: g.group_id, p_action_type: 'group_created', p_entity_type: 'group', p_entity_id: g.group_id, p_payload: { group_name: g.group_name, work_mode: 'mixed' } }), 'log')
    must(await M.client.rpc('join_group_by_code', { p_code: join_code }), 'join')
    for (let i = 1; i <= 12; i++) {
      const u = i % 2 ? M : L
      must(await u.client.rpc('log_activity', { p_group_id: g.group_id, p_action_type: 'comment_added', p_entity_type: 'group', p_entity_id: g.group_id, p_payload: { title: 'KPI-5', preview: `log ${i}` } }), 'log')
    }
    const logs = must(await L.client.from('activity_logs').select('seq').eq('group_id', g.group_id).order('seq'), 'logs')
    groups[kind] = { group_id: g.group_id, name: g.group_name, logCount: logs.length, maxSeq: logs[logs.length - 1].seq, before: await verify(L.client, g.group_id) }
    console.log(`${kind.padEnd(8)} ${logs.length} logs, before tampering: ${JSON.stringify(groups[kind].before)}`)
  }
  const pre = KINDS.every((k) => groups[k].before.is_valid)
  console.log(`ตัวควบคุมก่อนแก้: ${pre ? 'ทุกกลุ่มสมบูรณ์' : 'มีกลุ่มที่ไม่สมบูรณ์ตั้งแต่ก่อนแก้ (การวัดรอบนี้ใช้ไม่ได้)'}`)

  const gidOf = (kind) => `(select group_id from public.groups where group_name = '${nameOf(kind)}')`
  const sql = `-- KPI-5 รอบที่ ${round}: แก้ประวัติกิจกรรมโดยเจตนา เฉพาะกลุ่มทดสอบ ${KINDS.slice(1).map(nameOf).join(', ')}
-- รันทั้งไฟล์ใน Supabase SQL Editor ครั้งเดียว (ปิด trigger ของ activity_logs ชั่วคราวในธุรกรรมนี้เท่านั้น แล้วเปิดคืน)
begin;
alter table public.activity_logs disable trigger user;

-- (1) แก้ payload ของแถวลำดับที่ 5 โดยไม่คำนวณ hash ใหม่
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb
where seq = 5 and group_id = ${gidOf('edit')};

-- (2) ลบแถวลำดับที่ 5
delete from public.activity_logs
where seq = 5 and group_id = ${gidOf('delete')};

-- (3) แทรกแถวปลอมต่อท้าย โดยไม่รู้วิธีคำนวณ hash
insert into public.activity_logs (group_id, seq, actor_id, action_type, entity_type, entity_id, payload, created_at, prev_hash, hash)
select l.group_id, l.seq + 1, l.actor_id, 'comment_added', l.entity_type, l.entity_id,
       '{"title": "KPI-5", "preview": "แถวปลอม"}'::jsonb, now(), l.hash, md5(random()::text)
from public.activity_logs l
where l.group_id = ${gidOf('insert')}
order by l.seq desc limit 1;

alter table public.activity_logs enable trigger user;
commit;

-- ให้งานตรวจอัตโนมัติ (A09) บันทึกผลทันที ไม่ต้องรอรอบ 01:00 น.
select public.run_integrity_checks() as groups_checked;

-- ตรวจผล: control ต้อง true, ที่เหลือต้อง false
select g.group_name, v.is_valid, v.broken_at_seq
from public.groups g, lateral public.verify_activity_chain(g.group_id) v
where g.group_name like '[TEST] KPI-5 % r${round}'
order by g.group_name;
`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi5-round${round}-tamper.sql`), sql)
  writeFileSync(stateFile, JSON.stringify({ kpi: 'KPI-5', round, at: nowIso(), commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), groups }, null, 2))
  console.log(`\nสร้าง docs/evaluation/results/kpi5-round${round}-tamper.sql แล้ว ให้ผู้วิจัยรันใน SQL Editor`)
}

async function check(L) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const g = state.groups
  const expectedBroken = { control: null, edit: 5, delete: 6, insert: g.insert.maxSeq + 1 }
  const page = await pageAs('leader')
  const results = []
  for (const kind of KINDS) {
    const after = await verify(L.client, g[kind].group_id)
    const expectValid = kind === 'control'
    // ปุ่มตรวจในหน้าเว็บ (CatchUpDigest) และแถบเตือนจากการตรวจอัตโนมัติ (A09)
    await page.goto(`${BASE_URL}/dashboard/groups/${g[kind].group_id}`)
    await page.getByRole('button', { name: 'ตรวจสอบความถูกต้องของประวัติ' }).click()
    const uiText = await page.getByText(/ประวัติครบถ้วน|พบความผิดปกติของประวัติ|ตรวจสอบไม่สำเร็จ/).first().innerText({ timeout: 20000 })
    await page.waitForLoadState('networkidle')
    const banner = await page.getByText('ตรวจพบว่าประวัติกิจกรรมของกลุ่มนี้ถูกแก้ไขหรือลบ').count() > 0
    const checks = {
      rpc: after.is_valid === expectValid && (expectValid || after.broken_at_seq === expectedBroken[kind]),
      ui: expectValid ? uiText.includes('ประวัติครบถ้วน') : uiText.includes(`พบความผิดปกติของประวัติที่ลำดับ ${expectedBroken[kind]}`),
      a09Banner: banner === !expectValid,
    }
    results.push({ kind, before: g[kind].before, after, expectedBroken: expectedBroken[kind], uiText, banner, checks, pass: checks.rpc && checks.ui })
    console.log(`${checks.rpc && checks.ui ? 'PASS' : 'FAIL'} ${kind.padEnd(8)} rpc=${JSON.stringify(after)} (คาด ${expectValid ? 'valid' : `broken ${expectedBroken[kind]}`}) ui="${uiText}" banner=${banner} [A09 ${checks.a09Banner ? 'PASS' : 'FAIL'}]`)
  }
  await closeBrowser()
  for (const kind of KINDS) await L.client.rpc('archive_group', { p_group_id: g[kind].group_id })
  const kpi5 = results.every((r) => r.pass)
  const a09 = results.every((r) => r.checks.a09Banner)
  console.log(`\nKPI-5 round ${round}: ${kpi5 ? 'PASS' : 'FAIL'} (detected ${results.filter((r) => r.kind !== 'control' && r.pass).length}/3, control ${results[0].pass ? 'valid' : 'NOT valid'}); A09 banner: ${a09 ? 'PASS' : 'FAIL'}`)
  writeFileSync(join(dir, `kpi5-round${round}.json`), JSON.stringify({ ...state, checkedAt: nowIso(), checkCommit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), pass: kpi5, a09BannerPass: a09, results }, null, 2))
}

// ใช้บัญชีของ KPI-9 (สมัครไว้ก่อนเปิดยืนยันอีเมล) สคริปต์ KPI-9 เก็บเข้าคลังเฉพาะกลุ่มของตัวเอง
const L = await signInAs('leader', 'ผู้ทดสอบ หัวหน้า')
const M = await signInAs('member', 'ผู้ทดสอบ สมาชิก')
if (phase === 'setup') await setup(L, M)
else await check(L)
