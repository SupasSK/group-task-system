<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## กฎของโปรเจกต์ GroupTask (Next.js 16 App Router + TypeScript + Supabase)
- ใช้ supabase client จาก '@/utils/supabase' (createClient) เท่านั้น ห้ามสร้าง client ใหม่ และห้ามฝัง URL หรือคีย์ Supabase ในโค้ด
- ห้ามเขียนลง activity_logs โดยตรง ให้เรียก logActivity() จาก '@/lib/logActivity' หลังบันทึกสำเร็จเท่านั้น ถ้า log ล้มเหลวต้องไม่ทำให้งานหลักล้มเหลว
- ห้ามแก้ไฟล์นอกเหนือที่ระบุในพรอมต์ ห้ามลบหรือเปลี่ยนโค้ดเดิมที่ทำงานอยู่ ถ้าติด RLS หรือ constraint ให้หยุดและรายงาน error ห้ามแก้ policy หรือสร้างตารางเอง
- สไตล์: Tailwind เดียวกับ dashboard เดิม ข้อความหน้าเว็บเป็นภาษาไทย
- ก่อนแก้ ให้ระบุรายชื่อไฟล์ที่จะแก้หรือสร้าง หลังแก้ให้สรุปสิ่งที่เปลี่ยน
- ค่าที่ฐานข้อมูลยอมรับเท่านั้น (ค่าอื่นจะ error):
  tasks.status: pending | assigned | accepted | in_progress | completed | rejected
  tasks.priority: low | medium | high | urgent
  tasks.assignment_type: leader_assign | open_choice
  task_responses.response: accepted | rejected
- คอลัมน์ของ tasks: deadline, assigned_to, assigned_by, assignment_type, start_date, completed_at, updated_at (ห้ามใช้ due_date หรือ assignee_id) ทุกครั้งที่ update tasks ให้ตั้ง updated_at เป็นเวลาปัจจุบัน
- รูปแบบ payload ของ log ที่ต้องตรงกันทุกที่:
  group_created {group_name, work_mode}
  member_added {role, email?}
  task_created {title, priority, deadline}
  task_updated {title, changes: {ชื่อฟิลด์: {from, to}}}
  task_status_changed {title, from, to}
  task_assigned {title, assigned_to, assignment_type}
  task_accepted {title}
  task_declined {title, reason} (ค่าที่เก็บในฐานข้อมูลคือ 'rejected' แต่ชื่อ action ใน log ใช้ task_declined)
  task_claimed {title}
  comment_added / decision_added {title, preview}
  eval_round_opened / eval_round_closed {title} (title คือชื่อรอบประเมิน ไม่บันทึก log ตอนสมาชิกส่งแบบประเมิน เพื่อไม่เปิดเผยว่าใครส่งเมื่อไร)
- ในหน้า client component ที่เป็น dynamic route (เช่น [id]) ให้อ่านค่า id ด้วย useParams() จาก 'next/navigation' เท่านั้น ห้ามรับ params เป็น props
- ก่อนเขียนโค้ดที่ใช้ API ของ Next.js ที่ไม่แน่ใจ ให้ทำตามคำแนะนำในบล็อก nextjs-agent-rules ที่อยู่ด้านบนของไฟล์นี้ก่อน
