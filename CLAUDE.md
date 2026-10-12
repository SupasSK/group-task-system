# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

กฎของโปรเจกต์ (ค่าที่ฐานข้อมูลยอมรับ, รูปแบบ payload ของ log, ข้อห้าม) อยู่ใน AGENTS.md และมีผลบังคับเสมอ:

@AGENTS.md

## คำสั่ง

```bash
npm run dev          # next dev --turbo → http://localhost:3000
npm run build        # next build (ไม่รัน lint ให้แล้วใน Next 16)
npx eslint .         # lint — ใช้คำสั่งนี้แทน `npm run lint`
npx tsc --noEmit     # type-check (tsconfig ตั้ง strict: false)
```

- `npm run lint` เรียก `next lint` ซึ่งถูกถอดออกใน Next.js 16 แล้ว จึงใช้ไม่ได้ ให้เรียก ESLint ตรง ๆ
- โปรเจกต์ยังไม่มีชุดทดสอบและไม่มี test runner
- ต้องมี `.env.local` ที่กำหนด `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## สถาปัตยกรรม

### การเข้าถึงข้อมูล
ไม่มี API route, server action หรือ server component ที่ดึงข้อมูล ทุกหน้าใน `app/dashboard/**` เป็น client component (`'use client'`) ที่เรียก Supabase จากเบราว์เซอร์โดยตรงผ่าน `createClient()` ใน `utils/supabase.ts` (singleton ฝั่งเบราว์เซอร์) ความปลอดภัยของข้อมูลจึงขึ้นกับ RLS ของ Supabase ทั้งหมด

โค้ดฝั่งเซิร์ฟเวอร์มีแค่สองจุด และทั้งคู่สร้าง `createServerClient` ที่ผูกกับ cookie เอง:
- `middleware.ts` — ถ้ายังไม่ล็อกอินจะ redirect ไป `/login` (ยกเว้น `/login`, `/auth`) ถ้าล็อกอินแล้วเข้า `/` หรือ `/login` จะ redirect ไป `/dashboard` หมายเหตุ: ชื่อไฟล์ `middleware` ถูก deprecate ใน Next 16 (ชื่อใหม่คือ `proxy`) ยังทำงานได้ อย่าเปลี่ยนชื่อเองถ้าไม่ได้รับคำสั่ง
- `app/auth/callback/route.ts` — แลก OAuth code เป็น session แล้ว upsert โปรไฟล์ลง `public.users` (หน้า `app/login/page.tsx` ก็ upsert ตารางเดียวกันสำหรับการล็อกอินด้วยอีเมล)

`app/page.tsx` แค่ render หน้า login ส่วน `app/dashboard/layout.tsx` ตรวจผู้ใช้ซ้ำฝั่ง client และวาง `Sidebar`

### สคีมา Supabase
สคีมาไม่ได้อยู่ใน repo (ไม่มี migration) ต้องอนุมานจากโค้ด `supabase-fix-rls.sql` เป็นสคริปต์ที่รันมือใน SQL Editor และครอบคลุมเฉพาะ `groups` กับ `group_members`

- Primary key ใช้ชื่อตามตาราง ไม่ใช่ `id`: `groups.group_id`, `tasks.task_id`, `users.user_id` (เท่ากับ auth uid), `task_responses.response_id`
- ตารางที่ใช้: `users`, `groups`, `group_members`, `tasks`, `task_responses`, `activity_logs`
- `groups.work_mode`: `leader_all` | `member_choose` | `mixed` — `group_members.role`: `leader` | `member`
- RPC ที่มีอยู่: `log_activity` (เรียกผ่าน `lib/logActivity.ts` เท่านั้น), `join_group_by_code(p_code)` คืน `{joined_group_id, joined_group_name, newly_joined}`, `find_user_by_email(p_email)`
- การ join ชื่อสมาชิกทำเป็นสอง query (ดึง `group_members` แล้วค่อยดึง `users` ด้วย `.in('user_id', ...)`) ไม่ได้ใช้ embedded select

### หน้าที่ใช้ข้อมูลจริง กับหน้าที่ยังเป็น mock
โปรเจกต์อยู่ระหว่างย้ายจากข้อมูลจำลอง (`lib/mock-data.ts`) ไป Supabase ก่อนแก้หน้าใดให้ดูก่อนว่าอยู่ฝั่งไหน:

- **ข้อมูลจริง:** `groups/[id]` (หน้าหลักของกลุ่ม: แท็บภาพรวม/งาน/สมาชิก/สรุป และ flow งานทั้งหมด — สร้าง, มอบหมาย, รับ, ปฏิเสธ, claim, เปลี่ยนสถานะ), `projects/new` (สร้างกลุ่ม), `projects/join` (เข้ากลุ่มด้วยรหัส 6 ตัว), `member`
- **ผสม:** `dashboard/page.tsx` (กลุ่มจริง + สถิติ/โครงการ/กิจกรรมแบบ hardcode), `leader` (กลุ่มจริงปนกับกลุ่มตัวอย่าง `p1`/`p2`)
- **mock ล้วน:** `tasks`, `tasks/new`, `projects`, `activity`, `contributions`
- `projects/[project_id]` เป็นหน้าเก่า ถ้า id เป็น UUID จะ redirect ไป `groups/[id]`

flow ของงานถูกเขียนซ้ำอยู่ทั้งใน `groups/[id]/page.tsx` และ `member/page.tsx` (update `tasks` → insert `task_responses` → `logActivity`) ถ้าแก้พฤติกรรมฝั่งหนึ่งให้ตรวจอีกฝั่งด้วย

Sidebar ลิงก์ไปแค่ `/dashboard`, `/dashboard/leader`, `/dashboard/member` หน้าอื่นเข้าถึงผ่านลิงก์ในเนื้อหาหรือ `IconNavigationToolbar`

### สไตล์
Tailwind v4 โหลดผ่าน `@import "tailwindcss"` ใน `app/globals.css` (PostCSS plugin `@tailwindcss/postcss`) `tailwind.config.ts` ไม่ได้ถูกอ้างด้วย `@config` จึงไม่มีผล คลาสร่วมของระบบคือ `gt-card`, `gt-input`, `gt-btn`, `gt-gradient`, `gt-gradient-x` ใน `globals.css` ไอคอนใช้ `lucide-react`
