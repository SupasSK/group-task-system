// KPI-9 เกณฑ์ข้อ 5 (ตาราง OWASP Top 10:2025, เกณฑ์ฉบับที่ 3) — ตรวจ A02, A03, A04, A05, A06, A07, A10
// A01 = kpi9-rls.mjs, A08 = KPI-5 + กรณี AL-05..07, A09 = KPI-5 (แถบเตือน) + งาน pg_cron
// ZAP baseline (A02) รันแยกด้วย Docker และ build ในเครื่อง (A04) ต้องทำก่อนรันสคริปต์นี้
// วิธีรัน: node kpi9-owasp.mjs <round>
import { writeFileSync, mkdirSync, readdirSync, readFileSync, statSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { signInAs, newClient, nowIso, ROOT, SUPABASE_URL, ANON_KEY, emailFor } from './lib.mjs'
import { pageAs, launch, closeBrowser, BASE_URL } from './browser.mjs'

const round = Number(process.argv[2])
if (!round) throw new Error('ใช้: node kpi9-owasp.mjs <round>')
const code6 = () => Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X')
const must = (res, what) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res.data }
const results = []
const check = (cat, id, desc, pass, detail) => {
  results.push({ cat, id, desc, pass: !!pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${cat} ${id.padEnd(8)} ${desc}  [${typeof detail === 'string' ? detail : JSON.stringify(detail)}]`)
}

// ---------- A02 security headers ----------
async function a02() {
  for (const path of ['/', '/login', '/dashboard']) {
    const res = await fetch(`${BASE_URL}${path}`)
    const h = (k) => res.headers.get(k)
    const csp = h('content-security-policy') || ''
    const missing = []
    if (!csp) missing.push('Content-Security-Policy')
    if (!h('x-frame-options') && !/frame-ancestors/.test(csp)) missing.push('X-Frame-Options/frame-ancestors')
    if ((h('x-content-type-options') || '').toLowerCase() !== 'nosniff') missing.push('X-Content-Type-Options')
    if (!h('referrer-policy')) missing.push('Referrer-Policy')
    if (!h('strict-transport-security')) missing.push('Strict-Transport-Security')
    check('A02', `HDR${path}`, `header ครบที่ ${path} (หน้าสุดท้าย ${new URL(res.url).pathname})`, missing.length === 0, missing.length ? `ขาด ${missing.join(', ')}` : 'ครบ')
  }
}

// ---------- A03 supply chain ----------
function a03() {
  let audit
  try { audit = JSON.parse(execSync('npm audit --omit=dev --json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) }
  catch (e) { audit = JSON.parse(e.stdout.toString()) }
  const v = audit.metadata.vulnerabilities
  check('A03', 'AUDIT', 'npm audit --omit=dev ไม่มี High/Critical', v.high === 0 && v.critical === 0, v)
  const tracked = execSync('git ls-files package-lock.json', { cwd: ROOT }).toString().trim()
  check('A03', 'LOCK', 'package-lock.json อยู่ใน repo', tracked === 'package-lock.json', tracked || 'ไม่อยู่')
  const dir = mkdtempSync(join(tmpdir(), 'gt-ci-'))
  for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(ROOT, f), join(dir, f))
  let ok = true
  let detail = ''
  try { detail = execSync('npm ci --ignore-scripts --no-audit --no-fund', { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim().split('\n').pop() }
  catch (e) { ok = false; detail = (e.stderr || e.stdout).toString().split('\n').slice(-3).join(' ') }
  rmSync(dir, { recursive: true, force: true })
  check('A03', 'NPM-CI', 'npm ci ติดตั้งจาก lockfile ได้ (ในโฟลเดอร์ชั่วคราว)', ok, detail)
}

// ---------- A04 cryptographic ----------
async function a04() {
  const res = await fetch(BASE_URL.replace('https://', 'http://'), { redirect: 'manual' })
  const loc = res.headers.get('location') || ''
  check('A04', 'HTTPS', 'http:// redirect ไป https://', res.status >= 300 && res.status < 400 && loc.startsWith('https://'), `${res.status} -> ${loc}`)
  const hsts = (await fetch(BASE_URL)).headers.get('strict-transport-security')
  check('A04', 'HSTS', 'มี HSTS', !!hsts, hsts || 'ไม่มี')
  // สแกนไฟล์ JS ที่ build ในเครื่อง (commit เดียวกับที่ deploy) หา service_role
  const root = join(ROOT, '.next', 'static')
  const files = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p) } }
  walk(root)
  const hits = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    if (text.includes('service_role')) hits.push(`${f}: service_role`)
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      try { if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role === 'service_role') hits.push(`${f}: service_role JWT`) } catch { /* ไม่ใช่ JWT */ }
    }
  }
  check('A04', 'SECRETS', `ไฟล์ JS ที่ build แล้ว ${files.length} ไฟล์ไม่มี service_role`, files.length > 0 && hits.length === 0, hits.length ? hits : `${files.length} files clean`)
}

// ---------- A05 injection ----------
async function a05(L, M) {
  const SQLI = "x'; DROP TABLE public.tasks; --"
  const XSS = '<img src=x onerror="window.__gtXss=1">'
  const join_code = code6()
  const g = must(await L.client.from('groups').insert({ group_name: `[TEST] KPI-9 A05 r${round}`, work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
  must(await L.client.from('group_members').insert({ group_id: g.group_id, user_id: L.user.id, role: 'leader' }), 'leader')
  must(await M.client.rpc('join_group_by_code', { p_code: join_code }), 'join')

  // กรอกผ่านหน้าเว็บจริง: ชื่องาน 2 งาน และความเห็น
  const page = await pageAs('leader')
  let dialog = false
  page.on('dialog', async (d) => { dialog = true; await d.dismiss() })
  for (const title of [SQLI, XSS]) {
    await page.goto(`${BASE_URL}/dashboard/groups/${g.group_id}?tab=tasks`)
    await page.getByRole('button', { name: '+ สร้างงาน' }).click()
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'บันทึกสร้างงาน' }) })
    await form.getByPlaceholder('เช่น ออกแบบหน้าหลัก, ตรวจสอบระบบฐานข้อมูล').fill(title)
    await form.getByText('เปิดให้สมาชิกเลือกเอง').click()
    await form.getByRole('button', { name: 'บันทึกสร้างงาน' }).click()
    await page.getByText(/สร้างงาน .* สำเร็จ/).waitFor({ timeout: 20000 })
  }
  await page.goto(`${BASE_URL}/dashboard/groups/${g.group_id}?tab=tasks`)
  const card = page.locator('div.p-5.space-y-3').filter({ has: page.getByRole('heading', { name: SQLI, exact: true }) })
  await card.getByRole('button', { name: 'บันทึกความคืบหน้าและการตัดสินใจ' }).click()
  await card.getByPlaceholder('เช่น แก้บทที่ 2 เพิ่มรูปประกอบแล้ว').fill(XSS)
  await card.getByRole('button', { name: 'บันทึก', exact: true }).click()
  await card.getByText(XSS).waitFor({ timeout: 20000 })
  await page.goto(`${BASE_URL}/dashboard/groups/${g.group_id}`) // หน้าภาพรวมแสดงความเห็นใน log ด้วย
  await page.waitForLoadState('networkidle')
  await page.goto(`${BASE_URL}/dashboard/groups/${g.group_id}?tab=tasks`)
  await page.waitForLoadState('networkidle')
  const tasksTableOk = !(await L.client.from('tasks').select('task_id').limit(1)).error
  const titles = must(await L.client.from('tasks').select('title').eq('group_id', g.group_id), 'titles').map((t) => t.title)
  const shown = await page.getByRole('heading', { name: SQLI, exact: true }).count() + await page.getByRole('heading', { name: XSS, exact: true }).count()
  const xssRan = await page.evaluate(() => window.__gtXss === 1)
  check('A05', 'SQLI-STORE', 'ข้อความ SQL injection ถูกเก็บเป็นข้อความ และตาราง tasks ยังอยู่', titles.includes(SQLI) && tasksTableOk, { stored: titles.includes(SQLI), tasksTableOk })
  check('A05', 'XSS', 'ข้อความ XSS แสดงเป็นข้อความ ไม่มี script ทำงาน', titles.includes(XSS) && shown === 2 && !xssRan && !dialog, { shownAsText: shown, xssRan, dialog })

  // รหัสเข้ากลุ่มแบบ injection ผ่านหน้าเว็บ ต้องไม่เข้ากลุ่มใด
  const before = must(await M.client.from('group_members').select('group_id').eq('user_id', M.user.id), 'm').length
  const mp = await pageAs('member')
  await mp.goto(`${BASE_URL}/dashboard/projects/join`)
  const boxes = mp.locator('input[maxlength="1"]')
  const inj = "'OR1=1"
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(inj[i])
  await mp.getByRole('button', { name: 'เข้าร่วมกลุ่ม' }).click()
  const msg = await mp.getByText(/ไม่พบกลุ่ม|เข้าร่วมกลุ่มไม่สำเร็จ|เข้าร่วมกลุ่ม .* สำเร็จ/).first().innerText({ timeout: 20000 })
  const after = must(await M.client.from('group_members').select('group_id').eq('user_id', M.user.id), 'm').length
  check('A05', 'JOIN-CODE', 'รหัสเข้ากลุ่มแบบ injection ไม่ทำให้เข้ากลุ่มใด', after === before, `${msg} (${before}->${after})`)

  // ตัวกรองของ API กับค่าที่มี quote ต้องไม่คืนข้อมูลเกิน
  const leak = must(await M.client.from('tasks').select('task_id').eq('title', "x' or '1'='1"), 'filter')
  check('A05', 'FILTER', "ตัวกรอง title = \"x' or '1'='1\" ไม่คืนแถว", leak.length === 0, `${leak.length} rows`)
  must(await L.client.rpc('archive_group', { p_group_id: g.group_id }), 'archive')
}

// ---------- A06 reason enforced in the database ----------
async function a06(L, M, M2) {
  const join_code = code6()
  const g = must(await L.client.from('groups').insert({ group_name: `[TEST] KPI-9 A06 r${round}`, work_mode: 'mixed', join_code, created_by: L.user.id }).select().single(), 'group')
  must(await L.client.from('group_members').insert({ group_id: g.group_id, user_id: L.user.id, role: 'leader' }), 'leader')
  for (const u of [M, M2]) must(await u.client.rpc('join_group_by_code', { p_code: join_code }), 'join')
  const mk = async (extra = {}) => must(await L.client.from('tasks').insert({ group_id: g.group_id, title: `A06 ${Math.random()}`, priority: 'medium', difficulty: 'medium', status: 'assigned', assignment_type: 'leader_assign', assigned_to: M.user.id, assigned_by: L.user.id, deadline: '2026-11-10T05:00:00Z', updated_at: nowIso(), ...extra }).select().single(), 'task')
  const t = await mk()
  const field = async (col) => must(await L.client.from('tasks').select(col).eq('task_id', t.task_id).single(), 'read')[col]
  const tryUpdate = async (patch) => (await L.client.from('tasks').update({ ...patch, updated_at: nowIso() }).eq('task_id', t.task_id)).error?.message ?? null
  let err = await tryUpdate({ deadline: '2026-11-20T05:00:00Z' })
  check('A06', 'DEADLINE', 'หัวหน้าแก้กำหนดส่งผ่าน API โดยไม่มีเหตุผล ถูกปฏิเสธ', !!err && String(await field('deadline')).startsWith('2026-11-10'), err || 'ไม่ถูกปฏิเสธ')
  err = await tryUpdate({ assigned_to: M2.user.id })
  check('A06', 'ASSIGNEE', 'หัวหน้าเปลี่ยนคนทำผ่าน API โดยไม่มีเหตุผล ถูกปฏิเสธ', !!err && (await field('assigned_to')) === M.user.id, err || 'ไม่ถูกปฏิเสธ')
  err = await tryUpdate({ difficulty: 'hard' })
  check('A06', 'DIFFICULTY', 'หัวหน้าเปลี่ยนความยากผ่าน API โดยไม่มีเหตุผล ถูกปฏิเสธ', !!err && (await field('difficulty')) === 'medium', err || 'ไม่ถูกปฏิเสธ')
  err = await tryUpdate({ deadline: '2026-11-20T05:00:00Z', change_reason: 'อาจารย์เลื่อนกำหนดส่ง' })
  check('A06', 'WITH-REASON', 'หัวหน้าแก้กำหนดส่งพร้อมเหตุผลผ่าน API ได้ และไม่เก็บเหตุผลค้าง', !err && String(await field('deadline')).startsWith('2026-11-20') && (await field('change_reason')) === null, err || 'ok')
  // ข้อยกเว้นที่กำหนดไว้: มอบหมายงานที่ถูกปฏิเสธใหม่ (การปฏิเสธคือเหตุผล)
  const r = await mk({ status: 'rejected' })
  const reErr = (await L.client.from('tasks').update({ assigned_to: M2.user.id, status: 'assigned', updated_at: nowIso() }).eq('task_id', r.task_id)).error?.message ?? null
  check('A06', 'REASSIGN', 'มอบหมายงานที่ถูกปฏิเสธใหม่ได้โดยไม่ต้องใส่เหตุผล (ข้อยกเว้น)', !reErr, reErr || 'ok')
  must(await L.client.rpc('archive_group', { p_group_id: g.group_id }), 'archive')
}

// ---------- A07 authentication ----------
async function a07() {
  const s = await (await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: ANON_KEY } })).json()
  check('A07', 'CONFIRM', 'เปิดยืนยันอีเมล (mailer_autoconfirm = false)', s.mailer_autoconfirm === false, `mailer_autoconfirm=${s.mailer_autoconfirm}`)
  const weak = await newClient().auth.signUp({ email: emailFor('weakpw'), password: 'Ab1234x' })
  check('A07', 'PWLEN', 'สมัครด้วยรหัสผ่าน 7 ตัวไม่สำเร็จ', !!weak.error, weak.error?.message || 'สมัครได้')

  const b = await launch()
  const ctx = await b.newContext({ locale: 'th-TH' })
  const page = await ctx.newPage()
  // ลิงก์รีเซ็ตต้องพาไปหน้าตั้งรหัสผ่านใหม่ ดักคำขอไว้ไม่ให้ส่งอีเมลจริง
  let redirectTo = null
  await page.route('**/auth/v1/recover**', async (route) => {
    redirectTo = new URL(route.request().url()).searchParams.get('redirect_to')
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto(`${BASE_URL}/login`)
  await page.getByRole('button', { name: 'ลืมรหัสผ่าน?' }).click()
  await page.locator('input[type="email"]').last().fill(emailFor('member'))
  await page.locator('button[type="submit"]').last().click()
  await page.waitForTimeout(3000)
  check('A07', 'RESET-LINK', 'อีเมลรีเซ็ตพาไป /auth/callback?next=/auth/reset-password', !!redirectTo && redirectTo.endsWith('/auth/callback?next=/auth/reset-password'), redirectTo || 'ไม่ได้ส่งคำขอ')
  const res = await page.goto(`${BASE_URL}/auth/reset-password`)
  const noSession = await page.getByText('ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว').count() > 0
  check('A07', 'RESET-PAGE', 'หน้าตั้งรหัสผ่านใหม่มีอยู่ และปฏิเสธเมื่อไม่มี session จากลิงก์', res.status() === 200 && noSession, `${res.status()} noSessionMessage=${noSession}`)
  // มีลิงก์ที่ถูกต้อง (มี session) ต้องเห็นฟอร์ม: ทดสอบด้วยบัญชีที่ล็อกอินแล้ว
  const lp = await pageAs('member')
  await lp.goto(`${BASE_URL}/auth/reset-password`)
  const form = await lp.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }).count() > 0
  check('A07', 'RESET-FORM', 'เมื่อมี session หน้าตั้งรหัสผ่านใหม่แสดงฟอร์ม', form, `form=${form}`)
  await ctx.close()
}

// ---------- A10 exceptional conditions ----------
async function a10() {
  for (const path of ['/dashboard', '/dashboard/groups/00000000-0000-0000-0000-000000000000']) {
    const page = await pageAs('leader')
    await page.context().route(`${SUPABASE_URL}/**`, (route) => route.abort())
    await page.goto(`${BASE_URL}${path}`)
    const started = Date.now()
    let stuck = true
    while (Date.now() - started < 30000) {
      const t = await page.locator('body').innerText().catch(() => '')
      if (!/กำลังโหลด/.test(t)) { stuck = false; break }
      await page.waitForTimeout(1000)
    }
    const text = await page.locator('body').innerText().catch(() => '')
    const nextError = /Application error|Unhandled Runtime Error|client-side exception/i.test(text)
    check('A10', `OFFLINE${path.length > 12 ? '-GROUP' : '-DASH'}`, `ตัดการเชื่อมต่อ Supabase แล้ว ${path.slice(0, 26)} ไม่ค้างที่กำลังโหลด และไม่ใช่หน้า error ของ Next.js`, !stuck && !nextError, { stuck, nextError, after: `${Math.round((Date.now() - started) / 1000)}s`, text: text.replace(/\s+/g, ' ').slice(0, 140) })
    await page.context().close()
  }
}

const L = await signInAs('leader', 'ผู้ทดสอบ หัวหน้า')
const M = await signInAs('member', 'ผู้ทดสอบ สมาชิก')
const M2 = await signInAs('member2', 'ผู้ทดสอบ สมาชิกสอง')
for (const [name, fn] of [['A02', a02], ['A03', a03], ['A04', a04], ['A05', () => a05(L, M)], ['A06', () => a06(L, M, M2)], ['A07', a07], ['A10', a10]]) {
  try { await fn() } catch (e) { check(name, 'ERROR', 'สคริปต์ล้มระหว่างตรวจ', false, e.message.split('\n')[0]) }
}
await closeBrowser()
const passed = results.filter((r) => r.pass).length
console.log(`\nKPI-9 round ${round} OWASP checks: ${passed}/${results.length} passed`)
const dir = join(ROOT, 'docs', 'evaluation', 'results')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, `kpi9-round${round}-owasp.json`), JSON.stringify({ kpi: 'KPI-9', criterion: 5, round, at: nowIso(), commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), passed, total: results.length, results }, null, 2))
