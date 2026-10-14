-- ==============================================================================
-- ให้ผู้ใช้แก้ชื่อที่แสดง (full_name) ของตัวเองได้
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- - policy: แก้ได้เฉพาะแถวของตัวเอง
-- - สิทธิ์ระดับคอลัมน์: แก้ได้เฉพาะ full_name (กันการแก้ email / user_id)
-- ==============================================================================

BEGIN;

DROP POLICY IF EXISTS "user updates own profile" ON public.users;
CREATE POLICY "user updates own profile"
ON public.users FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (full_name) ON public.users TO authenticated;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็น policy "user updates own profile" (cmd = UPDATE)
-- ==============================================================================
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users'
ORDER BY cmd;
