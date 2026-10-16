// ตัวช่วยเบราว์เซอร์อัตโนมัติ: ล็อกอินผ่านหน้า login จริงของเว็บที่ deploy แล้วอ่านข้อความบนหน้า
import { chromium } from 'playwright'
import { emailFor, TEST_PASSWORD } from './lib.mjs'

export const BASE_URL = process.env.GT_BASE_URL || 'https://group-task-system.vercel.app'

let browser
export async function launch() {
  browser ??= await chromium.launch()
  return browser
}
export async function closeBrowser() {
  await browser?.close()
  browser = undefined
}

// คืน page ที่ล็อกอินแล้วด้วยบัญชีทดสอบของบทบาทนั้น (บัญชีต้องถูกสร้างด้วย signInAs ก่อน)
export async function pageAs(role) {
  const b = await launch()
  const context = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/login`)
  await page.locator('input[type="email"]').first().fill(emailFor(role))
  await page.getByPlaceholder('กรอกรหัสผ่านของคุณ').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL('**/dashboard**', { timeout: 30000 })
  return page
}

// เปิดหน้าแล้วรอจนข้อความที่กำหนดปรากฏ (ข้อมูลโหลดเสร็จ) คืนข้อความทั้งหน้า
export async function textOf(page, path, waitForText) {
  await page.goto(`${BASE_URL}${path}`)
  if (waitForText) await page.getByText(waitForText, { exact: false }).first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  return page.locator('body').innerText()
}
