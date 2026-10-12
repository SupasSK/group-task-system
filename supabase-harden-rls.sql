-- ==============================================================================
-- ปิดช่องโหว่ RLS ของ group_members และกันผู้รับงานแก้ priority / deadline
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- หมายเหตุ: หลังรันไฟล์นี้แล้ว ห้ามรัน supabase-fix-rls.sql ซ้ำ
--           เพราะจะสร้าง policy ที่หละหลวมกลับมาอีก
-- ==============================================================================

BEGIN;

-- 1. ลบ policy ที่หละหลวมของ group_members
--    - SELECT แบบ true: ทุกคนอ่านรายชื่อสมาชิกของทุกกลุ่มได้
--    - INSERT ตัวเอง: เพิ่มตัวเองเข้ากลุ่มใดก็ได้ด้วย role ใดก็ได้
--    - UPDATE ตัวเอง: เลื่อนตัวเองเป็น leader ได้
DROP POLICY IF EXISTS "Allow authenticated users to view group_members" ON public.group_members;
DROP POLICY IF EXISTS "Allow authenticated users to insert group_members" ON public.group_members;
DROP POLICY IF EXISTS "user can add self as member" ON public.group_members;
DROP POLICY IF EXISTS "Allow authenticated users to update group_members" ON public.group_members;

-- 2. ผู้สร้างกลุ่มเพิ่มตัวเองเป็นสมาชิกได้ (ใช้ตอนสร้างกลุ่มใหม่)
--    การเข้ากลุ่มด้วยรหัสทำผ่าน join_group_by_code (security definer) จึงไม่ต้องมี policy
--    หัวหน้าเพิ่มคนอื่นใช้ policy เดิม "leader can add other members"
DROP POLICY IF EXISTS "creator can add self to own group" ON public.group_members;
CREATE POLICY "creator can add self to own group"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.group_id = group_members.group_id
        AND g.created_by = auth.uid()
    )
);

-- 3. ผู้ใช้อ่านแถวสมาชิกของตัวเองได้เสมอ
--    (รายชื่อคนอื่นในกลุ่มใช้ policy เดิม "members can read group roster")
DROP POLICY IF EXISTS "user can read own membership" ON public.group_members;
CREATE POLICY "user can read own membership"
ON public.group_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 4. เฉพาะหัวหน้ากลุ่มแก้ priority และ deadline ของงานได้
--    (auth.uid() เป็น null เมื่อแก้จาก SQL Editor จึงไม่ถูกบล็อก)
CREATE OR REPLACE FUNCTION public.tasks_guard_leader_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null
     and (new.priority is distinct from old.priority
          or new.deadline is distinct from old.deadline)
     and not public.is_group_leader(old.group_id) then
    raise exception 'only the group leader can change priority or deadline';
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS tasks_guard_leader_fields ON public.tasks;
CREATE TRIGGER tasks_guard_leader_fields
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_guard_leader_fields();

COMMIT;

-- ==============================================================================
-- ตรวจผล: group_members ควรเหลือ policy 4 ตัว
--   creator can add self to own group (INSERT)
--   leader can add other members      (INSERT)
--   members can read group roster     (SELECT)
--   user can read own membership      (SELECT)
-- ==============================================================================
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_members'
ORDER BY cmd, policyname;
