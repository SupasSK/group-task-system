-- ==============================================================================
-- ความยากของงาน (ใช้ถ่วงน้ำหนักภาระงานในคะแนนการมีส่วนร่วม ร่วมกับ priority)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- - งานที่มีอยู่แล้วจะได้ความยาก 'medium'
-- - เฉพาะหัวหน้ากลุ่มแก้ difficulty ได้ (ขยาย trigger เดิมจาก supabase-harden-rls.sql)
-- ==============================================================================

BEGIN;

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_difficulty_check;
ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard'));

-- เฉพาะหัวหน้ากลุ่มแก้ priority, deadline และ difficulty ของงานได้
-- (auth.uid() เป็น null เมื่อแก้จาก SQL Editor จึงไม่ถูกบล็อก)
CREATE OR REPLACE FUNCTION public.tasks_guard_leader_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null
     and (new.priority is distinct from old.priority
          or new.deadline is distinct from old.deadline
          or new.difficulty is distinct from old.difficulty)
     and not public.is_group_leader(old.group_id) then
    raise exception 'only the group leader can change priority, deadline or difficulty';
  end if;
  return new;
end $function$;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็นคอลัมน์ difficulty ค่าเริ่มต้น 'medium'
-- ==============================================================================
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'difficulty';
