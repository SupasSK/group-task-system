# ผลการวัดตามเกณฑ์ฉบับที่ 4 — รอบที่ 1 (17 ต.ค. 2569)

- เว็บที่วัด: https://group-task-system.vercel.app (Vercel) ฐานข้อมูล Supabase ของโปรเจกต์จริง กลุ่มทดสอบขึ้นต้นด้วย `[TEST] v4`
- สคริปต์: `evaluation/v4-*` ผลที่คาดของทุกกรณี commit ก่อนรันรอบจริง (`ea29c9c`, `862abd7`)
- ทุก KPI รัน pilot ก่อนรอบจริง (ผล pilot ไม่บันทึก) สิ่งที่แก้ระหว่าง pilot: KPI-2 งาน "ไม่ระบุความยาก" ต้องไม่ส่งค่า เพราะคอลัมน์ `difficulty` เป็น NOT NULL

## ตารางสรุป

| KPI | เกณฑ์ | ผลรอบที่ 1 | ผ่าน | ไฟล์ผล |
|---|---|---|---|---|
| KPI-1 สรุปสิ่งที่พลาดไป | ป้าย "ใหม่" 10/10 และรายการก่อนรับทราบมีป้าย 0/3 | 10/10 และ 0/3 | ผ่าน | `v4-kpi1-round1.json` |
| KPI-2 คะแนนการมีส่วนร่วม | คะแนนรวม, 4 ส่วน (±0.5) และส่วนแบ่ง % ตรงกับการคำนวณด้วยมือทุกคน | 4/4 คน ตรงครบ 6 ค่าต่อคน | ผ่าน | `v4-kpi2-round1.json`, `v4-kpi2-expected.md` |
| KPI-3 ตรวจจับการแก้ log | ตรวจพบ 10/10 และกลุ่มควบคุมไม่ถูกเตือน | 10/10, กลุ่มควบคุมสมบูรณ์ ลำดับที่รายงานตรงกับที่คาดทุกแบบ | ผ่าน | `v4-kpi3-round1.json`, `v4-kpi3-r1-tamper.sql` |
| KPI-4 ความปลอดภัย: การเข้าถึง | 122 กรณีตรงกับที่คาด 100% และ 2 run เหมือนกัน | run 1: 122/122, run 2: 121/122 (P6-02) | ไม่ผ่าน (เครื่องมือผิดพลาด ดูด้านล่าง) | `v4-kpi4-round1-run{1,2}.json` |
| KPI-4 ความปลอดภัย: ZAP | ไม่มี High และ Medium ทุกตัวมีการวิเคราะห์ | High 0, Medium 3 (ชุดเดียวกันทั้ง 2 ครั้ง) วิเคราะห์ด้านล่าง | ผ่าน | `v4-kpi4-round1-zap-run{1,2}.*` |
| KPI-4 ความปลอดภัย: npm audit | ไม่มี Critical | 0 ทุกระดับ ทั้ง 2 ครั้ง | ผ่าน | `v4-kpi4-round1-npm-audit-run{1,2}.json` |
| KPI-5 การใช้งาน (SUS) | คะแนนเฉลี่ย ≥ 68 | ยังไม่ได้ทดสอบ (ผู้วิจัยดำเนินการนอกระบบ) | — | — |
| KPI-6 ประสิทธิภาพเว็บ | ทุกหน้า Performance ≥ 80 และ LCP ≤ 2.5 วินาที | `/dashboard` 95, LCP 0.44 วินาที; หน้ากลุ่ม 98, LCP 1.04 วินาที | ผ่าน | `v4-kpi6-round1.json` |

## KPI-4 การเข้าถึง: สาเหตุที่รอบที่ 1 ไม่ผ่าน
- ครั้งแรกที่รัน (23:16 น.) ทั้ง 2 run ล้มตั้งแต่ล็อกอินด้วย `fetch failed` (เชื่อมต่อเครือข่ายไม่ได้) ไม่มีข้อมูลหรือผลถูกสร้าง จึงรันใหม่เวลา 23:20 น.
- run 2 ไม่ผ่าน P6-02 (token หมดอายุ) เพราะสคริปต์ลบ token ที่หมดอายุทิ้งหลัง run 1 ใช้ไปแล้ว run 2 จึงไม่มี token ให้ทดสอบ เป็นความผิดพลาดของเครื่องมือ ไม่ใช่ผลของระบบ (run 1 ทดสอบกรณีเดียวกันได้ผล `JWT expired` ถูกปฏิเสธ)
- ผลอื่นทั้ง 121 กรณีเหมือนกันทั้ง 2 run
- แก้สคริปต์ให้เก็บ token หมดอายุไว้ (`3c22fa1`) แล้ววัดใหม่เป็นรอบที่ 2

ตัวอย่างสาเหตุที่ถูกปฏิเสธ (run 1): token ปลอม `None of the keys was able to decode the JWT`, token หมดอายุ `JWT expired`,
เชิญผู้ร่วมทำเกินจำนวน `no collaborator slots left for this task`, แก้กำหนดส่งโดยไม่ใส่เหตุผล `a reason is required to change the deadline, assignee or difficulty`,
รูปเกิน 2 MB `The object exceeded the maximum allowed size`, อ่าน `activity_heads` `permission denied for table activity_heads`,
injection ทั้ง 5 กรณีไม่มีผลข้างเคียง (เช่น `find_user_by_email('%')` คืน 0 แถว, ชื่องานที่ฝัง `<img onerror>` แสดงเป็นข้อความและสคริปต์ไม่ทำงาน)

## KPI-4 ZAP: การวิเคราะห์ Medium (ผู้วิจัยตรวจและยืนยันแล้ว 18 ต.ค. 2569)

| แจ้งเตือน | URL ที่พบ | หลักฐาน | ผลกระทบต่อระบบนี้ | ยอมรับ / แก้ |
|---|---|---|---|---|
| CSP: `script-src 'unsafe-inline'` | `/`, `/login` | header `Content-Security-Policy` มี `script-src 'self' 'unsafe-inline'` | ถ้ามีช่องโหว่ XSS สคริปต์ที่ฝังในหน้าจะทำงานได้ แต่ React แสดงข้อมูลผู้ใช้เป็นข้อความเสมอ (ยืนยันด้วยกรณี P7-05) และ CSP ส่วนอื่นยังจำกัด: `connect-src` ส่งข้อมูลได้เฉพาะ Supabase ของโปรเจกต์, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` | ยอมรับ: Next.js ใส่สคริปต์ inline ในหน้าเอง ทางแก้คือ CSP แบบ nonce ซึ่งทำให้ทุกหน้าต้อง render ใหม่ทุกคำขอ กระทบความเร็ว (KPI-6) เสนอเป็นงานในอนาคต |
| CSP: `style-src 'unsafe-inline'` | `/`, `/login` | `style-src 'self' 'unsafe-inline'` | style ที่ฝังได้ใช้ปลอมหน้าตาได้ แต่ขโมยข้อมูลไม่ได้เมื่อ `connect-src` / `img-src` จำกัดปลายทางไว้ | ยอมรับ: เหตุผลเดียวกัน (Next.js และ style ของคอมโพเนนต์ใช้ inline style) |
| Cross-Domain Misconfiguration (`Access-Control-Allow-Origin: *`) | `/`, `/login`, `/_next/static/...`, `/favicon.ico` | header `Access-Control-Allow-Origin: *` ที่ Vercel ใส่ | ไฟล์ที่พบเป็นไฟล์สาธารณะ (หน้า login, JS/CSS, ไอคอน) ไม่มีข้อมูลผู้ใช้ ข้อมูลจริงอยู่ที่ Supabase ซึ่งต้องใช้ token และ `*` ไม่อนุญาตให้เว็บอื่นอ่านคำตอบที่แนบ cookie | ยอมรับ: ไม่มีข้อมูลที่ต้องปกป้องใน URL ที่พบ |
