// เกณฑ์ฉบับที่ 4 KPI-6 ประสิทธิภาพเว็บ: Lighthouse preset desktop หน้า /dashboard และ /dashboard/groups/<id> ของกลุ่มใน v4-kpi6-fixture.json
// ล็อกอินด้วยบัญชีหัวหน้าในเบราว์เซอร์เดียวกับที่ Lighthouse ใช้ วัดหน้าละ 6 ครั้ง ทิ้งครั้งแรก ใช้มัธยฐานของ 5 ครั้งที่เหลือ
// เกณฑ์ (ทุกหน้า): มัธยฐาน Performance ≥ 80 และมัธยฐาน LCP ≤ 2.5 วินาที
// ต้องรัน node v4-kpi6-setup.mjs ก่อน 1 ครั้ง
// วิธีรัน: node v4-kpi6-lighthouse.mjs <round>   หรือ   node v4-kpi6-lighthouse.mjs pilot (หน้าละ 1 ครั้ง ไม่บันทึกผล)
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, hostname, cpus } from 'node:os'
import { chromium } from 'playwright'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import { TEST_PASSWORD, HERE } from './lib.mjs'
import { BASE_URL } from './browser.mjs'
import { roundArg, writeResult } from './v4-lib.mjs'

const { pilot, round } = roundArg()
const RUNS = pilot ? 1 : 6
const fx = JSON.parse(readFileSync(join(HERE, 'v4-kpi6-fixture.json'), 'utf8'))
const PORT = 9334
const pages = ['/dashboard', `/dashboard/groups/${fx.group_id}`]
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

const profile = mkdtempSync(join(tmpdir(), 'gt-lh-v4-'))
const ctx = await chromium.launchPersistentContext(profile, { args: [`--remote-debugging-port=${PORT}`], viewport: { width: 1350, height: 940 } })
const page = ctx.pages()[0] || await ctx.newPage()
await page.goto(`${BASE_URL}/login`)
await page.locator('input[type="email"]').first().fill(fx.leader)
await page.getByPlaceholder('กรอกรหัสผ่านของคุณ').fill(TEST_PASSWORD)
await page.locator('button[type="submit"]').first().click()
await page.waitForURL('**/dashboard**', { timeout: 30000 })

const results = []
let env = null
for (const path of pages) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const { lhr } = await lighthouse(`${BASE_URL}${path}`, { port: PORT, output: 'json', logLevel: 'error', disableStorageReset: true }, desktopConfig)
    env ??= { lighthouse: lhr.lighthouseVersion, userAgent: lhr.environment?.hostUserAgent, benchmarkIndex: lhr.environment?.benchmarkIndex }
    const a = (id) => lhr.audits[id]?.numericValue
    runs.push({
      score: Math.round(lhr.categories.performance.score * 100), finalUrl: lhr.finalDisplayedUrl,
      fcp: a('first-contentful-paint'), lcp: a('largest-contentful-paint'), tbt: a('total-blocking-time'), cls: a('cumulative-layout-shift'), si: a('speed-index'),
      warmup: !pilot && i === 0,
    })
    console.log(`${path.slice(0, 30).padEnd(30)} ครั้งที่ ${i + 1}${runs.at(-1).warmup ? ' (อุ่นเครื่อง ทิ้ง)' : ''}: score ${runs.at(-1).score} LCP ${Math.round(runs.at(-1).lcp)} ms (${runs.at(-1).finalUrl})`)
  }
  const kept = runs.filter((r) => !r.warmup)
  const medianScore = median(kept.map((r) => r.score))
  const medianLcp = median(kept.map((r) => r.lcp))
  // หน้าที่ถูกพาไป /login แปลว่าไม่ได้วัดหน้าที่ตั้งใจ นับว่าไม่ผ่าน
  const onTarget = kept.every((r) => r.finalUrl.includes(path))
  results.push({ path, runs, medianScore, medianLcp, onTarget, pass: onTarget && medianScore >= 80 && medianLcp <= 2500 })
}
await ctx.close()
rmSync(profile, { recursive: true, force: true })

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.path.slice(0, 30).padEnd(30)} มัธยฐาน score ${r.medianScore}, LCP ${Math.round(r.medianLcp)} ms${r.onTarget ? '' : ' (ไม่ได้อยู่หน้าที่ตั้งใจ)'}`)
if (!pilot) {
  writeResult(`v4-kpi6-round${round}.json`, { kpi: 'KPI-6', round, baseUrl: BASE_URL, preset: 'desktop', fixture: fx, environment: { ...env, machine: hostname(), cpu: cpus()[0]?.model }, pass: results.every((r) => r.pass), results })
}
