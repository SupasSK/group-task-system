-- ==============================================================================
-- ให้หัวหน้ากลุ่มลบงานได้ (ลบจริง)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรัน supabase-task-collaborators.sql ก่อน
--
-- กติกา:
--   - ลบได้เฉพาะหัวหน้าของกลุ่มที่งานนั้นอยู่
--   - ผู้ร่วมทำ (task_collaborators) และฟีดแบค (task_feedback) ถูกลบตามอยู่แล้ว (ON DELETE CASCADE)
--   - คำตอบรับ/ปฏิเสธงาน (task_responses) และบันทึกความคืบหน้า (task_comments)
--     ถูกปรับ foreign key ให้ลบตามงานด้วย ไม่อย่างนั้นจะลบงานที่มีข้อมูลเหล่านี้ไม่ได้
--   - ประวัติกิจกรรม (activity_logs) ไม่ถูกลบ หน้าเว็บบันทึก task_deleted ก่อนลบงาน
-- ==============================================================================

BEGIN;

-- 1. policy ลบงาน
DROP POLICY IF EXISTS "leader deletes tasks" ON public.tasks;
CREATE POLICY "leader deletes tasks"
ON public.tasks
FOR DELETE
TO authenticated
USING (is_group_leader(group_id));

-- 2. ให้ task_responses และ task_comments ลบตามงาน
--    หา foreign key เดิมที่ชี้ไป tasks แล้วสร้างใหม่เป็น ON DELETE CASCADE (ชื่อ constraint เดิม)
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.conname, c.conrelid::regclass AS tbl, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid = 'public.tasks'::regclass
          AND c.conrelid IN ('public.task_responses'::regclass, 'public.task_comments'::regclass)
          AND c.confdeltype <> 'c'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
        EXECUTE format(
            'ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE CASCADE',
            r.tbl,
            r.conname,
            regexp_replace(r.def, '\s+ON DELETE \w+( \w+)?', '', 'i')
        );
    END LOOP;
END $$;

COMMIT;

-- ตรวจผล: ทุกแถวควรเป็น confdeltype = 'c' (cascade)
SELECT c.conrelid::regclass AS table_name, c.conname, c.confdeltype
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = 'public.tasks'::regclass;
