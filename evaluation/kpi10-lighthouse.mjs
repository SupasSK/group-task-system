// KPI-10 Lighthouse 13.4.1 (preset desktop) หน้า /login, /dashboard และ /dashboard/groups/[id] ของกลุ่ม KPI-10
// ล็อกอินด้วยบัญชีหัวหน้าในเบราว์เซอร์เดียวกับที่ Lighthouse ใช้ (persistent profile) และไม่ล้าง storage ระหว่างวัด
// วัดหน้าละ 6 ครั้ง ทิ้งครั้งแรก ใช้ค่ามัธยฐานของ 5 ครั้งที่เหลือ
// วิธีรัน: node kpi10-lighthouse.mjs <round>   หรือ   node kpi10-lighthouse.mjs pilot (หน้าละ 1 ครั้ง ไม่บันทึกผล)
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { emailFor, TEST_PASSWORD, HERE, ROOT, nowIso } from './lib.mjs'
import { BASE_URL } from './browser.mjs'

const arg = process.argv[2] || 'pilot'
const pilot = arg === 'pilot'
const round = pilot ? 0 : Number(arg)
const RUNS = pilot ? 1 : 6
const fx = JSON.parse(readFileSync(join(HERE, 'kpi10-fixture.json'), 'utf8'))
const PORT = 9333
const pages = ['/login', '/dashboard', `/dashboard/groups/${fx.group_id}`]
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

const profile = mkdtempSync(join(tmpdir(), 'gt-lh-'))
const ctx = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`], viewport: { width: 1350, height: 940 } })
const page = ctx.pages()[0] || await ctx.newPage()
const login = async () => {
  await page.goto(`${BASE_URL}/login`)
  if (!page.url().includes('/login')) return
  await page.locator('input[type="email"]').first().fill(emailFor('k6leader'))
  await page.getByPlaceholder('กรอกรหัสผ่านของคุณ').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
}

const results = []
for (const path of pages) {
  // หน้า /login วัดตอนยังไม่ล็อกอิน (ผู้ที่ล็อกอินแล้วจะถูกพาไป dashboard)
  if (path === '/login') await ctx.clearCookies()
  else await login()
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const r = await lighthouse(`${BASE_URL}${path}`, { port: PORT, output: 'json', logLevel: 'error', disableStorageReset: true }, desktopConfig)
    const lhr = r.lhr
    const a = (id) => lhr.audits[id]?.numericValue
    runs.push({
      score: Math.round(lhr.categories.performance.score * 100), finalUrl: lhr.finalDisplayedUrl,
      fcp: a('first-contentful-paint'), lcp: a('largest-contentful-paint'), tbt: a('total-blocking-time'), cls: a('cumulative-layout-shift'), si: a('speed-index'),
      requests: lhr.audits['network-requests']?.details?.items?.length,
    })
    console.log(`${path.slice(0, 30).padEnd(30)} run ${i + 1}: score ${runs.at(-1).score} LCP ${Math.round(runs.at(-1).lcp)} ms (${runs.at(-1).finalUrl})`)
  }
  const kept = pilot ? runs : runs.slice(1)
  const med = median(kept.map((r) => r.score))
  results.push({ path, runs, medianScore: med, medianLcp: median(kept.map((r) => r.lcp)), pass: med >= 80 })
}
await ctx.close()
rmSync(profile, { recursive: true, force: true })

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.path.slice(0, 30).padEnd(30)} median score ${r.medianScore} (median LCP ${Math.round(r.medianLcp)} ms)`)
if (!pilot) {
  const dir = join(ROOT, 'docs', 'evaluation', 'results')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `kpi10-round${round}-lighthouse.json`), JSON.stringify({ kpi: 'KPI-10', part: 'lighthouse', round, at: nowIso(), commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), lighthouse: '13.4.1', preset: 'desktop', pass: results.every((r) => r.pass), results }, null, 2))
}
