// ตัวช่วยร่วมของสคริปต์วัดผลตามเกณฑ์ฉบับที่ 4 (docs/evaluation/criteria.md)
// ไฟล์ผลขึ้นต้นด้วย v4- เพื่อไม่ปนกับผลของชุด KPI เดิมที่ใช้เลขซ้ำกัน
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { nowIso, ROOT } from './lib.mjs'

export const RESULTS = join(ROOT, 'docs', 'evaluation', 'results')
export const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }
export const commitHash = () => execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()

// อ่าน <round> หรือ pilot จาก argv ที่ตำแหน่ง i
export function roundArg(i = 2) {
  const arg = process.argv[i] || 'pilot'
  const pilot = arg === 'pilot'
  const round = pilot ? 0 : Number(arg)
  if (!pilot && !round) throw new Error('ต้องระบุ <round> เป็นตัวเลข หรือ pilot')
  return { pilot, round, label: pilot ? 'pilot' : `r${round}` }
}

export function writeResult(file, data) {
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, file), JSON.stringify({ criteria: 'v4', at: nowIso(), commit: commitHash(), ...data }, null, 2))
  console.log(`บันทึกผล docs/evaluation/results/${file}`)
}

export const logAs = async (u, gid, action, entityType, entityId, payload) =>
  must(await u.client.rpc('log_activity', { p_group_id: gid, p_action_type: action, p_entity_type: entityType, p_entity_id: entityId, p_payload: payload }), `log ${action}`)

// สร้างกลุ่มแบบเดียวกับหน้า projects/new แล้วให้สมาชิกเข้าด้วยรหัส
export async function createGroup(leader, name, members = []) {
  const join_code = code6()
  const g = must(await leader.client.from('groups').insert({ group_name: name, work_mode: 'mixed', join_code, created_by: leader.user.id }).select().single(), 'create group')
  must(await leader.client.from('group_members').insert({ group_id: g.group_id, user_id: leader.user.id, role: 'leader' }), 'leader membership')
  await logAs(leader, g.group_id, 'group_created', 'group', g.group_id, { group_name: name, work_mode: 'mixed' })
  for (const u of members) must(await u.client.rpc('join_group_by_code', { p_code: join_code }), `join ${u.role}`)
  return g
}

// เก็บเข้าคลังเฉพาะกลุ่มของสคริปต์นี้ที่ค้างจากรอบก่อน (ไม่แตะกลุ่มของ KPI อื่นที่หัวหน้าคนเดียวกันสร้าง)
export async function archiveLeftovers(leader, namePrefix) {
  const { data } = await leader.client.from('groups').select('group_id').eq('created_by', leader.user.id).is('archived_at', null).like('group_name', `${namePrefix}%`)
  for (const g of data || []) await leader.client.rpc('archive_group', { p_group_id: g.group_id })
}
