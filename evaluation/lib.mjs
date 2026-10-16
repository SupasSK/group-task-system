// ตัวช่วยร่วมของสคริปต์ประเมินผล: โหลดค่า Supabase จาก .env.local และจัดการบัญชีทดสอบ
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..')

function readEnv(file) {
  const env = {}
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

const appEnv = readEnv(join(ROOT, '.env.local'))
export const SUPABASE_URL = appEnv.NEXT_PUBLIC_SUPABASE_URL
export const ANON_KEY = appEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !ANON_KEY) throw new Error('ไม่พบค่า Supabase ใน .env.local')

// รหัสผ่านของบัญชีทดสอบเก็บใน evaluation/.env.test (ไม่ commit) สร้างให้ครั้งแรก
const testEnvFile = join(HERE, '.env.test')
const testEnv = readEnv(testEnvFile)
if (!testEnv.TEST_PASSWORD) {
  testEnv.TEST_PASSWORD = randomBytes(18).toString('base64url')
  writeFileSync(testEnvFile, `TEST_PASSWORD=${testEnv.TEST_PASSWORD}\n`)
}
export const TEST_PASSWORD = testEnv.TEST_PASSWORD

export const EMAIL_DOMAIN = 'gt-eval.test'
export const emailFor = (role) => `gt.test.${role}@${EMAIL_DOMAIN}`

export function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ล็อกอินด้วยบัญชีทดสอบ ถ้ายังไม่มีให้สมัครแบบเดียวกับหน้า login แล้วบันทึกโปรไฟล์ลง users
export async function signInAs(role, fullName) {
  const client = newClient()
  const email = emailFor(role)
  let { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) {
    const up = await client.auth.signUp({ email, password: TEST_PASSWORD, options: { data: { full_name: fullName } } })
    if (up.error) throw new Error(`สมัครบัญชี ${role} ไม่สำเร็จ: ${up.error.message}`)
    if (!up.data.session) throw new Error(`บัญชี ${role} ต้องยืนยันอีเมล (Confirm email เปิดอยู่)`)
    data = up.data
  }
  const user = data.user
  await client.from('users').upsert(
    { user_id: user.id, email, full_name: fullName, last_seen: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  return { client, user, email, role }
}

export const nowIso = () => new Date().toISOString()
