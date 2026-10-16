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
- `package.json` ยังมี `@supabase/auth-helpers-nextjs` แต่ไม่มีโค้ดไหนใช้ ให้ใช้ `@supabase/ssr` ตามที่ใช้อยู่
- ต้องมี `.env.local` ที่กำหนด `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## สถาปัตยกรรม

### การเข้าถึงข้อมูล
ไม่มี API route, server action หรือ server component ที่ดึงข้อมูล ทุกหน้าใน `app/dashboard/**` เป็น client component (`'use client'`) ที่เรียก Supabase จากเบราว์เซอร์โดยตรงผ่าน `createClient()` ใน `utils/supabase.ts` (singleton ฝั่งเบราว์เซอร์) ความปลอดภัยของข้อมูลจึงขึ้นกับ RLS ของ Supabase ทั้งหมด

โค้ดฝั่งเซิร์ฟเวอร์มีแค่สองจุด และทั้งคู่สร้าง `createServerClient` ที่ผูกกับ cookie เอง:
- `middleware.ts` — ถ้ายังไม่ล็อกอินจะ redirect ไป `/login` (ยกเว้น `/login`, `/auth`) ถ้าล็อกอินแล้วเข้า `/` หรือ `/login` จะ redirect ไป `/dashboard` หมายเหตุ: ชื่อไฟล์ `middleware` ถูก deprecate ใน Next 16 (ชื่อใหม่คือ `proxy`) ยังทำงานได้ อย่าเปลี่ยนชื่อเองถ้าไม่ได้รับคำสั่ง
- `app/auth/callback/route.ts` — แลก OAuth code เป็น session แล้ว upsert โปรไฟล์ลง `public.users` (หน้า `app/login/page.tsx` ก็ upsert ตารางเดียวกันสำหรับการล็อกอินด้วยอีเมล)

`app/page.tsx` แค่ render หน้า login ส่วน `app/dashboard/layout.tsx` ตรวจผู้ใช้ซ้ำฝั่ง client และวาง `Sidebar`

### สคีมา Supabase
สคีมาส่วนใหญ่ไม่ได้อยู่ใน repo (ไม่มี migration) ต้องอนุมานจากโค้ด ไฟล์ `supabase-*.sql` ที่ root เป็นสคริปต์ที่รันมือใน SQL Editor แต่ละไฟล์ครอบคลุมบางส่วนเท่านั้น:
- `supabase-fix-rls.sql` — policy ของ `groups`/`group_members` รุ่นแรก (หละหลวม) **ห้ามรันซ้ำ** หลังรัน `supabase-harden-rls.sql` แล้ว
- `supabase-harden-rls.sql` — ปิด policy หละหลวมของ `group_members` และเพิ่ม trigger `tasks_guard_leader_fields` ที่ให้เฉพาะหัวหน้าแก้ `priority`/`deadline` ได้ (ผู้รับงานแก้แล้วจะ error)
- `supabase-peer-evaluation.sql` — ตาราง `eval_rounds`, `peer_evaluations` และ RPC ของการประเมินเพื่อน แถวคะแนนอ่านได้เฉพาะผู้ประเมินเอง หัวหน้าเห็นผลผ่าน RPC หลังปิดรอบเท่านั้น และไม่มี policy UPDATE/DELETE
- `supabase-task-difficulty.sql` — คอลัมน์ `tasks.difficulty`
- `supabase-task-collaborators.sql` — `tasks.headcount` (1–5 รวมคนหลัก), ตาราง `task_collaborators` (ผู้ร่วมทำ `pending`/`accepted`/`rejected`, มีได้ไม่เกิน headcount − 1 ตรวจด้วย trigger) และ `task_feedback` (ฟีดแบคเปิดชื่อหลังงานเสร็จ อ่านได้เฉพาะผู้ส่งกับหัวหน้า) พร้อมรวม trigger `tasks_guard_leader_fields` ฉบับล่าสุด: คนที่ไม่ใช่หัวหน้าแก้ priority/deadline/difficulty/headcount ไม่ได้, เปลี่ยน `assigned_to` ได้เฉพาะ claim งานว่างให้ตัวเอง, และกด completed ได้เฉพาะคนหลัก ส่วน UI ของทีมงานอยู่ใน `components/dashboard/TaskTeamPanel.tsx` ใช้ทั้งหน้ากลุ่มและหน้าสมาชิก
- `supabase-task-delete.sql` — policy DELETE ของ `tasks` (หัวหน้าเท่านั้น) และปรับ FK ของ `task_responses`/`task_comments` ให้ลบตามงาน ปุ่มลบอยู่ใน `TaskEditModal`
- `supabase-member-remove.sql` — RPC `remove_group_member(p_group_id, p_user_id)` (หัวหน้าเท่านั้น นำหัวหน้าออกไม่ได้) คืนงานที่ยังไม่เสร็จของคนนั้นเป็น `pending` ไม่มีผู้รับ และลบแถวผู้ร่วมทำของงานที่ยังไม่เสร็จ ทำในธุรกรรมเดียว คืนจำนวนงานที่ถูกปล่อย ปุ่มอยู่ในแท็บสมาชิกของ `groups/[id]`
- `supabase-member-leave.sql` — RPC `leave_group(p_group_id)` ให้สมาชิกออกเอง (หัวหน้าต้องโอนหัวหน้าก่อน) จัดการงานแบบเดียวกับ `remove_group_member` และล้าง `pending_leader_id` ถ้าคำขอค้างอยู่ที่คนนี้ หน้าเว็บบันทึก `member_left` ก่อนเรียก RPC ปุ่มอยู่ที่แถวของตัวเองในแท็บสมาชิก
- `supabase-leader-transfer.sql` — คอลัมน์ `groups.pending_leader_id` (คำขอโอนหัวหน้าที่รอตอบรับ ทีละคน) กับ RPC `request_leader_transfer(p_group_id, p_user_id)` (หัวหน้าเท่านั้น ส่ง null เพื่อยกเลิก) และ `respond_leader_transfer(p_group_id, p_accept)` (คนที่ถูกเสนอเท่านั้น ถ้าตอบรับจะสลับ role กับหัวหน้าเดิมและเปลี่ยน `groups.created_by` เป็นหัวหน้าคนใหม่ เพราะ policy แก้ไขกลุ่มและหน้า `leader` อิง `created_by`) ปุ่มอยู่ในแท็บสมาชิก แถบตอบรับอยู่ใต้การ์ดข้อมูลกลุ่มของ `groups/[id]`
- `supabase-profile.sql` — ให้ผู้ใช้แก้ `users.full_name` ของตัวเองได้ (สิทธิ์ UPDATE ระดับคอลัมน์เฉพาะ `full_name`) ชื่อที่แสดงอ่านจาก `public.users` ไม่ใช่ `user_metadata` ซึ่งถูกทับด้วยชื่อจาก Google ทุกครั้งที่ล็อกอิน
- `supabase-avatar.sql` — รูปโปรไฟล์: `users.avatar_url` คือรูปจาก Google (trigger `zz_sync_google_avatar` บน `auth.users` คัดลอกให้) ส่วน `users.custom_avatar_url` คือรูปที่อัปโหลดเองใน bucket `avatars` (โฟลเดอร์ `<user_id>/`, ไม่เกิน 2 MB) แสดง `custom_avatar_url ?? avatar_url` ผ่าน `components/ui/UserAvatar.tsx` (ไม่มีรูปจะแสดงตัวอักษรแรกของชื่อ) ตอนนี้ใช้ใน Sidebar, หน้า `profile`, `CatchUpDigest` และแท็บสมาชิกของ `groups/[id]`
- `supabase-group-archive.sql` — คอลัมน์ `groups.archived_at` กับ RPC `archive_group(p_group_id)` (หัวหน้าเท่านั้น) ลบกลุ่มแบบเก็บเข้าคลัง ข้อมูลและ log อยู่ครบ หน้า `dashboard`, `leader`, `member` กรองกลุ่มที่มี `archived_at` ออก และ `groups/[id]` แสดงว่าไม่พบกลุ่ม ปุ่มลบ (กดยืนยันครั้งเดียว) อยู่ในการ์ดข้อมูลกลุ่มด้านบนของ `groups/[id]` ถ้าเพิ่มหน้าใหม่ที่ดึงรายชื่อกลุ่มต้องกรองด้วย

- Primary key ใช้ชื่อตามตาราง ไม่ใช่ `id`: `groups.group_id`, `tasks.task_id`, `users.user_id` (เท่ากับ auth uid), `task_responses.response_id`, `task_comments.comment_id`
- ตารางที่ใช้: `users`, `groups`, `group_members`, `tasks`, `task_responses`, `task_comments`, `activity_logs`, `group_visits`, `eval_rounds`, `peer_evaluations`, `task_collaborators`, `task_feedback`
- `groups.work_mode`: `leader_all` | `member_choose` | `mixed` — `group_members.role`: `leader` | `member` — `task_comments.kind`: `comment` | `decision` — `tasks.work_url` เก็บลิงก์ผลงาน
- `group_visits(user_id, group_id, last_seen_at)` ใช้คำนวณกิจกรรมที่ยังไม่ได้อ่าน (`lib/unreadCounts.ts`, `CatchUpDigest`)
- RPC ที่มีอยู่: `log_activity` (เรียกผ่าน `lib/logActivity.ts` เท่านั้น), `join_group_by_code(p_code)` คืน `{joined_group_id, joined_group_name, newly_joined}`, `find_user_by_email(p_email)`, `verify_activity_chain(p_group_id)` (ตรวจว่า log ไม่ถูกแก้/ลบ), `get_peer_eval_results(p_round_id)`, `peer_eval_submitted_count(p_round_id)`, `remove_group_member(p_group_id, p_user_id)`, `leave_group(p_group_id)`, `request_leader_transfer(p_group_id, p_user_id)`, `respond_leader_transfer(p_group_id, p_accept)`, `archive_group(p_group_id)`
- การ join ชื่อสมาชิกทำเป็นสอง query (ดึง `group_members` แล้วค่อยดึง `users` ด้วย `.in('user_id', ...)`) ไม่ได้ใช้ embedded select

### หน้าต่าง ๆ
- **ข้อมูลจริง:** `dashboard/page.tsx`, `leader`, `member`, `profile` (แก้ชื่อที่แสดง), `projects/new` (สร้างกลุ่ม), `projects/join` (เข้ากลุ่มด้วยรหัส 6 ตัว) และ `groups/[id]` ซึ่งเป็นหน้าหลักของกลุ่ม มีแท็บ ภาพรวม/งาน/สมาชิก/สรุป/ประเมินเพื่อน (เลือกแท็บได้ด้วย query `?tab=`) และ flow งานทั้งหมด — สร้าง, มอบหมาย, รับ, ปฏิเสธ, claim, เปลี่ยนสถานะ
- ส่วนประกอบของหน้ากลุ่มแยกไว้ใน `components/dashboard/`: `CatchUpDigest` (สรุปสิ่งที่พลาดไป + ตรวจ log, ใช้ใน `leader` ด้วย), `TaskWorkPanel` (ลิงก์ผลงาน + ความเห็น/การตัดสินใจของงาน), `ParticipationSummary` (คะแนนการมีส่วนร่วม, ใช้ใน `leader` ด้วย, ปุ่มพิมพ์รายงานเรียก `window.print()` และ `@media print` ใน `globals.css` จะพิมพ์เฉพาะองค์ประกอบที่มีคลาส `gt-print-area`), `PeerEvaluation`, `TaskEditModal` (หัวหน้าแก้ไขงาน ต้องใส่เหตุผลเมื่อเปลี่ยนกำหนดส่ง/คนทำ/ความยาก)
- **redirect ทิ้ง:** `tasks`, `tasks/new` → `/dashboard/leader`; `projects`, `activity`, `contributions` → `/dashboard`
- ไม่มีข้อมูลตัวอย่าง (mock) เหลือในโค้ดแล้ว ทุกหน้าดึงข้อมูลจริงจาก Supabase
- ความคืบหน้าของโครงการคำนวณที่เดียวคือ `lib/projectProgress.ts` (งาน `completed` / งานทั้งหมด)
- น้ำหนักงานและภาระงานอยู่ใน `lib/workload.ts`: `taskWeight` (คะแนน priority 1–4 + difficulty 1–3), `taskTeam` (คนหลัก + ผู้ร่วมทำที่ไม่ได้ปฏิเสธ) และ `openWorkload` ที่หน้า `groups/[id]` ใช้แสดงภาระงานค้างของสมาชิกแต่ละคน ถ้าจะคำนวณภาระงานที่อื่นให้ใช้ฟังก์ชันเหล่านี้ อย่าเขียนสูตรใหม่

flow ของงานถูกเขียนซ้ำอยู่ทั้งใน `groups/[id]/page.tsx` และ `member/page.tsx` (update `tasks` → insert `task_responses` → `logActivity`) ถ้าแก้พฤติกรรมฝั่งหนึ่งให้ตรวจอีกฝั่งด้วย

Sidebar ลิงก์ไปแค่ `/dashboard`, `/dashboard/leader`, `/dashboard/member` หน้าอื่นเข้าถึงผ่านลิงก์ในเนื้อหา

### สไตล์
Tailwind v4 โหลดผ่าน `@import "tailwindcss"` ใน `app/globals.css` (PostCSS plugin `@tailwindcss/postcss`) `tailwind.config.ts` ไม่ได้ถูกอ้างด้วย `@config` จึงไม่มีผล คลาสร่วมของระบบคือ `gt-card`, `gt-input`, `gt-btn`, `gt-gradient`, `gt-gradient-x` ใน `globals.css` ไอคอนใช้ `lucide-react` (`components/ui/ProgressBar.tsx` มีอยู่แต่ยังไม่มีหน้าไหนใช้)
