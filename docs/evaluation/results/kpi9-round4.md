# KPI-9 ความปลอดภัย — รอบที่ 4 (16 ตุลาคม 2569) ตามเกณฑ์ฉบับที่ 3

- โค้ดที่วัด: commit `a48c5cb` (deploy บน Vercel เสร็จก่อนวัด)
- เกณฑ์ข้อ 5 (ตาราง OWASP Top 10:2025) เพิ่มในเกณฑ์ฉบับที่ 3 หลังจากรอบที่ 3 ผ่าน 4 เกณฑ์เดิมแล้ว

## สิ่งที่แก้ก่อนรอบนี้
| commit | หมวด | สิ่งที่แก้ |
|---|---|---|
| `a8fae8c` | A02, A07 | เพิ่ม security header ใน `next.config.ts`, เพิ่มหน้า `/auth/reset-password` (เดิมลิงก์รีเซ็ตพาไปหน้า login ที่ตั้งรหัสใหม่ไม่ได้), รหัสผ่านขั้นต่ำ 8 ตัว |
| `ebfdfea`, `beaa709` | A06 | `supabase-task-change-reason.sql` บังคับเหตุผลที่ฐานข้อมูล (ผู้วิจัยรันแล้ว) และ `TaskEditModal` ส่งเหตุผลไปด้วย |
| `26ab97e` | A09 | `supabase-integrity-checks.sql` ตรวจ hash chain รายวันด้วย pg_cron (ผู้วิจัยรันแล้ว) และแถบเตือน `IntegrityAlert` |
| `a48c5cb` | A10 | เมื่อเชื่อมต่อ Supabase ไม่ได้ แสดงข้อความแจ้งแทนการเด้งไปหน้า login หรือขึ้นว่า "ยังไม่มีกลุ่ม" (พบระหว่างทดลองเครื่องมือ) |
| ตั้งค่า Supabase | A07 | เปิด Confirm email และรหัสผ่านขั้นต่ำ 8 ตัว (ผู้วิจัยตั้งค่าแล้ว) |

## ผลตามเกณฑ์

| เกณฑ์ | ข้อกำหนด | ผล | ผ่าน |
|---|---|---|---|
| 1 ทดสอบสิทธิ์ | 100% | 114/114 ทั้ง 2 ครั้ง | ผ่าน |
| 2 ZAP baseline | ไม่มี High/Critical | Medium 3, Low 2, Info 5 | ผ่าน |
| 3 npm audit | ไม่มี Critical | 0 ทุกระดับ ทั้ง 2 ครั้ง | ผ่าน |
| 4 ความซ้ำได้ | ผล 2 ครั้งเหมือนกัน | สิทธิ์ 114 กรณีเหมือนกัน, ชุด alert ของ ZAP เหมือนกัน, npm audit เหมือนกัน | ผ่าน |
| 5 ตาราง OWASP Top 10:2025 | ครบ 10/10 หมวด | 10/10 หมวด | ผ่าน |

## เกณฑ์ข้อ 5 รายหมวด

| หมวด | มาตรการ | ผลการตรวจ | หลักฐาน |
|---|---|---|---|
| A01 Broken Access Control | RLS + RPC ตรวจสิทธิ์ | ผ่าน 114/114 ทั้ง 2 ครั้ง | `kpi9-round4-run{1,2}.json` |
| A02 Security Misconfiguration | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS | header ครบทั้ง `/`, `/login`, `/dashboard`; ZAP ไม่มี High | `kpi9-round4-owasp.json`, `kpi9-round4-zap-run{1,2}.*` |
| A03 Software Supply Chain Failures | lockfile + npm audit | ไม่มี High/Critical, lockfile อยู่ใน repo, `npm ci` ติดตั้งได้ | `kpi9-round4-owasp.json`, `kpi9-round4-npm-audit-run{1,2}.json` |
| A04 Cryptographic Failures | HTTPS + HSTS, ไม่มี secret ในโค้ดหน้าเว็บ | http → https (308), มี HSTS, JS ที่ build แล้ว 23 ไฟล์ไม่มี `service_role` | `kpi9-round4-owasp.json` |
| A05 Injection | PostgREST ใช้ parameter, React escape ข้อความ, ช่องรหัสรับเฉพาะตัวอักษรและตัวเลข | ข้อความ SQL injection และ XSS ที่กรอกผ่านหน้าเว็บถูกเก็บและแสดงเป็นข้อความ ไม่มี script ทำงาน, รหัสเข้ากลุ่มแบบ injection ถูกตัดเหลือ "OR11" และไม่เข้ากลุ่มใด, ตัวกรองที่มี quote ไม่คืนแถว | `kpi9-round4-owasp.json` |
| A06 Insecure Design | ฐานข้อมูลบังคับเหตุผลเมื่อหัวหน้าแก้กำหนดส่ง คนทำ หรือความยาก | เรียก API โดยไม่มีเหตุผลถูกปฏิเสธทั้ง 3 ฟิลด์, มีเหตุผลแก้ได้และไม่เก็บเหตุผลค้าง, ผ่านหน้าเว็บพร้อมเหตุผลแก้ได้ (KPI-4 รอบที่ 2 ขั้น S21) | `kpi9-round4-owasp.json`, `kpi4-round2.json` |
| A07 Authentication Failures | ยืนยันอีเมล, รหัสผ่านอย่างน้อย 8 ตัว, หน้าตั้งรหัสผ่านใหม่ | `mailer_autoconfirm=false`, สมัครด้วยรหัส 7 ตัวไม่สำเร็จ ("Password should be at least 8 characters."), ลิงก์รีเซ็ตพาไป `/auth/callback?next=/auth/reset-password`, หน้าตั้งรหัสใหม่ปฏิเสธเมื่อไม่มี session และแสดงฟอร์มเมื่อมี session | `kpi9-round4-owasp.json` |
| A08 Software or Data Integrity Failures | hash chain + activity_logs เขียนตรงไม่ได้ | KPI-5 ตรวจพบการแก้ 3/3 แบบ, AL-05..07 ผ่าน | `kpi5-round1.json`, `kpi9-round4-run{1,2}.json` |
| A09 Security Logging & Alerting Failures | ตรวจ hash chain รายวันด้วย pg_cron + แถบเตือนหัวหน้า | แถบเตือนขึ้นในกลุ่มที่สายบันทึกเสียทั้ง 3 กลุ่ม และไม่ขึ้นในกลุ่มควบคุม, งาน pg_cron `daily-activity-chain-check` ตั้งเวลา `0 18 * * *` และ `active = true` (ผู้วิจัยรัน `select jobname, schedule, active from cron.job` ใน SQL Editor 16 ต.ค. 2569) | `kpi5-round1.json`, ผลจาก SQL Editor |
| A10 Mishandling of Exceptional Conditions | fail closed + แจ้งข้อผิดพลาดเมื่อเชื่อมต่อไม่ได้ | กรณีที่ถูกปฏิเสธใน A01 ไม่คืนข้อมูล, ตัดการเชื่อมต่อ Supabase แล้ว dashboard และหน้ากลุ่มแสดง "เชื่อมต่อระบบไม่สำเร็จ" ในหน้าเดิม ไม่ค้างและไม่ใช่หน้า error ของ Next.js | `kpi9-round4-owasp.json` |

**ผลรอบที่ 4: ผ่านครบ 5 เกณฑ์**

## ความเสี่ยงที่ยังเหลือ (ยอมรับและบันทึกไว้)
- ZAP ระดับ Medium: CSP ยอมให้ `unsafe-inline` ทั้ง script และ style เพราะ Next.js แบบไม่ใช้ nonce ต้องใช้ (ตามคู่มือ Next.js) และ "Cross-Domain Misconfiguration" จาก header CORS ของไฟล์ static บน Vercel
- หัวหน้ากลุ่มยังตรวจได้ว่าอีเมลใดสมัครระบบแล้ว (`find_user_by_email`) เพราะการเพิ่มสมาชิกด้วยอีเมลต้องทำแบบนั้น
- log ยังบันทึกจากหน้าเว็บ หัวหน้าที่เรียก API ตรงแก้งานพร้อมเหตุผลได้โดยไม่เกิด log (แต่ต้องมีเหตุผล)
- hash chain ไม่มีกุญแจลับ ผู้ที่เข้าถึงฐานข้อมูลเต็มสิทธิ์คำนวณ hash ใหม่ทั้งสายได้ ป้องกันได้ด้วย hash ที่พิมพ์ในรายงานเก็บไว้นอกระบบ
- log การล็อกอินอยู่ที่ Supabase (เก็บได้ 1 วันใน free tier) ระบบไม่มีการแจ้งเตือนการล็อกอินผิดซ้ำ ๆ
- ZAP เป็นการสแกนแบบ passive และเข้าถึงได้เฉพาะหน้าที่ไม่ต้องล็อกอิน
- ระบบส่งอีเมลในตัวของ Supabase ส่งได้ประมาณ 2 ฉบับต่อชั่วโมง ผู้เข้าร่วมการทดลองควรล็อกอินด้วย Google
