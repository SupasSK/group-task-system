// เกณฑ์ฉบับที่ 4 KPI-3 การตรวจจับการแก้ไขประวัติกิจกรรม (แก้ 10 แบบ + กลุ่มควบคุม)
// ขั้นที่ 1: node v4-kpi3-chain.mjs setup <round|pilot>  สร้าง 11 กลุ่ม กลุ่มละ 14 log ตรวจว่าสมบูรณ์ก่อนแก้ แล้วสร้างไฟล์ SQL
// ขั้นที่ 2: ผู้วิจัยรันไฟล์ SQL ที่ได้ใน Supabase SQL Editor (แก้ log 10 แบบ แล้วรัน run_integrity_checks)
// ขั้นที่ 3: node v4-kpi3-chain.mjs check <round|pilot>   เรียก verify_activity_chain ของทุกกลุ่มแล้วบันทึกผล
// เกณฑ์: ตรวจพบ 10/10 และกลุ่มควบคุมไม่ถูกเตือน (ลำดับที่รายงานว่าเสียบันทึกไว้ประกอบ ไม่ใช่เกณฑ์)
// pilot เขียนไฟล์ลง evaluation/pilot-out/ แทน docs/evaluation/results/
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { signInAs, nowIso, HERE } from './lib.mjs'
import { must, logAs, createGroup, writeResult, commitHash, RESULTS } from './v4-lib.mjs'

const [phase, arg] = process.argv.slice(2)
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
if (!['setup', 'check'].includes(phase) || (!pilot && !round)) throw new Error('ใช้: node v4-kpi3-chain.mjs setup|check <round|pilot>')
const label = pilot ? 'pilot' : `r${round}`
const outDir = pilot ? join(HERE, 'pilot-out') : RESULTS
const stateFile = join(outDir, `v4-kpi3-${label}-setup.json`)
const sqlFile = join(outDir, `v4-kpi3-${label}-tamper.sql`)
const LOGS = 14
const nameOf = (kind) => `[TEST] v4 KPI-3 ${kind} ${label}`

// [ชื่อ, คำอธิบาย, ลำดับที่คาดว่าจะรายงาน]
const KINDS = [
  ['edit-payload', 'แก้ payload แถวที่ 5', 5],
  ['edit-actor', 'แก้ actor_id แถวที่ 5 เป็นสมาชิกอีกคน', 5],
  ['edit-time', 'แก้ created_at แถวที่ 5 ย้อนไป 1 วัน', 5],
  ['edit-action', 'แก้ action_type แถวที่ 5', 5],
  ['rehash', 'แก้ payload แถวที่ 5 แล้วคำนวณ hash ของแถวนั้นใหม่', 6],
  ['delete-first', 'ลบแถวแรก', 2],
  ['delete-mid', 'ลบแถวที่ 5', 6],
  ['delete-last', 'ลบแถวสุดท้าย', LOGS],
  ['insert-mid', 'แทรกแถวปลอมที่ลำดับ 5 (hash ถูกต้อง) และเลื่อนแถวเดิม', 6],
  ['swap', 'สลับ seq ของแถวที่ 5 และ 6', 5],
]
const ALL = ['control', ...KINDS.map((k) => k[0])]

async function verify(client, gid) {
  const row = must(await client.rpc('verify_activity_chain', { p_group_id: gid }), 'verify')[0]
  return { is_valid: row.is_valid, broken_at_seq: row.broken_at_seq }
}

function tamperSql(L, M) {
  const g = (kind) => `(select group_id from public.groups where group_name = '${nameOf(kind)}')`
  const at = (kind, seq) => `group_id = ${g(kind)} and seq = ${seq}`
  const rehash = `hash = public.activity_compute_hash(prev_hash, seq, group_id, actor_id, action_type, entity_type, entity_id, payload, created_at)`
  return `-- เกณฑ์ฉบับที่ 4 KPI-3 ${label}: แก้ประวัติกิจกรรมโดยเจตนา 10 แบบ เฉพาะกลุ่ม "${nameOf('<แบบ>')}" (กลุ่ม control ไม่แตะ)
-- รันทั้งไฟล์ใน Supabase SQL Editor ครั้งเดียว ปิด trigger ของ activity_logs ชั่วคราวในธุรกรรมนี้เท่านั้น แล้วเปิดคืน
-- (trigger ที่ปิดรวมถึง activity_logs_update_head จุดยึดปลายสายจึงไม่ขยับตามการแก้)
begin;
alter table public.activity_logs disable trigger user;

-- 1 edit-payload
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb where ${at('edit-payload', 5)};
-- 2 edit-actor (สลับผู้ทำระหว่างหัวหน้ากับสมาชิก)
update public.activity_logs set actor_id = case when actor_id = '${L.user.id}' then '${M.user.id}'::uuid else '${L.user.id}'::uuid end where ${at('edit-actor', 5)};
-- 3 edit-time
update public.activity_logs set created_at = created_at - interval '1 day' where ${at('edit-time', 5)};
-- 4 edit-action
update public.activity_logs set action_type = 'decision_added' where ${at('edit-action', 5)};
-- 5 rehash (ผู้แก้รู้สูตร hash แต่แก้เฉพาะแถวนี้)
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb where ${at('rehash', 5)};
update public.activity_logs set ${rehash} where ${at('rehash', 5)};
-- 6 delete-first
delete from public.activity_logs where ${at('delete-first', 1)};
-- 7 delete-mid
delete from public.activity_logs where ${at('delete-mid', 5)};
-- 8 delete-last
delete from public.activity_logs where ${at('delete-last', LOGS)};
-- 9 insert-mid: เลื่อน seq ตั้งแต่ 5 ขึ้นไป 1 ช่อง (ผ่าน +1000 เพื่อไม่ชนกัน) แล้วแทรกแถวปลอมที่ 5 ด้วย hash ที่คำนวณถูกต้อง
update public.activity_logs set seq = seq + 1000 where group_id = ${g('insert-mid')} and seq >= 5;
update public.activity_logs set seq = seq - 999 where group_id = ${g('insert-mid')} and seq >= 1000;
insert into public.activity_logs (group_id, seq, actor_id, action_type, entity_type, entity_id, payload, created_at, prev_hash, hash)
select l.group_id, 5, l.actor_id, 'comment_added', l.entity_type, l.entity_id, '{"title": "KPI-3", "preview": "แถวปลอม"}'::jsonb, l.created_at, l.hash,
       public.activity_compute_hash(l.hash, 5, l.group_id, l.actor_id, 'comment_added', l.entity_type, l.entity_id, '{"title": "KPI-3", "preview": "แถวปลอม"}'::jsonb, l.created_at)
from public.activity_logs l where l.group_id = ${g('insert-mid')} and l.seq = 4;
-- 10 swap
update public.activity_logs set seq = 1005 where ${at('swap', 5)};
update public.activity_logs set seq = 5 where ${at('swap', 6)};
update public.activity_logs set seq = 6 where ${at('swap', 1005)};

alter table public.activity_logs enable trigger user;
commit;

-- ให้งานตรวจอัตโนมัติบันทึกผลทันที ไม่ต้องรอรอบ 01:00 น.
select public.run_integrity_checks() as groups_checked;

-- ตรวจผล: control ต้อง true ที่เหลือต้อง false
select g.group_name, v.is_valid, v.broken_at_seq
from public.groups g, lateral public.verify_activity_chain(g.group_id) v
where g.group_name like '[TEST] v4 KPI-3 % ${label}'
order by g.group_name;
`
}

async function setup(L, M) {
  const groups = {}
  for (const kind of ALL) {
    const g = await createGroup(L, nameOf(kind), [M])
    // การสร้างกลุ่มและการเข้ากลุ่มอาจบันทึก log เอง จึงเติมให้ครบ 14 แถวจากจำนวนที่มีอยู่
    const { count } = await L.client.from('activity_logs').select('seq', { count: 'exact', head: true }).eq('group_id', g.group_id)
    for (let i = count + 1; i <= LOGS; i++) {
      await logAs(i % 2 ? L : M, g.group_id, 'comment_added', 'group', g.group_id, { title: 'KPI-3', preview: `log ${i}` })
    }
    const logs = must(await L.client.from('activity_logs').select('seq').eq('group_id', g.group_id).order('seq'), 'logs')
    const before = await verify(L.client, g.group_id)
    groups[kind] = { group_id: g.group_id, name: g.group_name, logCount: logs.length, maxSeq: logs.at(-1).seq, before }
    console.log(`${kind.padEnd(13)} ${logs.length} logs (seq ${logs[0].seq}..${logs.at(-1).seq}) ก่อนแก้: ${JSON.stringify(before)}`)
  }
  const ready = ALL.every((k) => groups[k].before.is_valid && groups[k].logCount === LOGS && groups[k].maxSeq === LOGS)
  console.log(ready ? '\nทุกกลุ่มสมบูรณ์ก่อนแก้ และมี log 14 แถว seq 1..14' : '\nมีกลุ่มที่ไม่พร้อม (การวัดรอบนี้ใช้ไม่ได้)')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(sqlFile, tamperSql(L, M))
  writeFileSync(stateFile, JSON.stringify({ criteria: 'v4', kpi: 'KPI-3', label, at: nowIso(), commit: commitHash(), ready, groups }, null, 2))
  console.log(`สร้าง ${sqlFile} แล้ว ให้ผู้วิจัยรันใน SQL Editor แล้วรัน check`)
}

async function check(L) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'))
  const results = []
  for (const kind of ALL) {
    const meta = KINDS.find((k) => k[0] === kind)
    const after = await verify(L.client, state.groups[kind].group_id)
    const latest = (await L.client.from('integrity_checks').select('checked_at, is_valid, broken_at_seq').eq('group_id', state.groups[kind].group_id).order('checked_at', { ascending: false }).limit(1)).data?.[0] ?? null
    const expectValid = kind === 'control'
    const pass = after.is_valid === expectValid
    results.push({ kind, desc: meta?.[1] ?? 'กลุ่มควบคุม ไม่แก้', expectedBrokenAt: meta?.[2] ?? null, before: state.groups[kind].before, after, latestIntegrityCheck: latest, pass })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${kind.padEnd(13)} ${JSON.stringify(after)} (คาด ${expectValid ? 'สมบูรณ์' : `เสีย ~ลำดับ ${meta[2]}`}) integrity_checks=${JSON.stringify(latest)}`)
  }
  for (const kind of ALL) await L.client.rpc('archive_group', { p_group_id: state.groups[kind].group_id })
  const detected = results.filter((r) => r.kind !== 'control' && r.pass).length
  const controlOk = results[0].pass
  const pass = detected === KINDS.length && controlOk && state.ready
  console.log(`\nKPI-3 ${label}: ตรวจพบ ${detected}/${KINDS.length}, กลุ่มควบคุม${controlOk ? 'ไม่ถูกเตือน' : 'ถูกเตือน'} → ${pass ? 'ผ่าน' : 'ไม่ผ่าน'}`)
  if (pilot) return
  writeResult(`v4-kpi3-round${round}.json`, { kpi: 'KPI-3', round, setup: state, detected, controlOk, pass, results })
}

// บัญชีของชุดเดิม KPI-5/9 (สมัครไว้ก่อนเปิดยืนยันอีเมล)
const L = await signInAs('leader', 'ผู้ทดสอบ หัวหน้า')
const M = await signInAs('member', 'ผู้ทดสอบ สมาชิก')
if (phase === 'setup') await setup(L, M)
else await check(L)
