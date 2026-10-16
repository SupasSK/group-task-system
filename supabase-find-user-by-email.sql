-- ==============================================================================
-- ปิดช่องโหว่ find_user_by_email (พบใน KPI-9 รอบที่ 1 กรณี R-07, R-08)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- ปัญหาเดิม: ใครก็เรียกได้ รวมถึงคนที่ไม่ได้ล็อกอิน (anon key อยู่ในโค้ดหน้าเว็บ)
--            จึงตรวจได้ว่าอีเมลใดสมัครระบบแล้ว และได้ user_id กับชื่อเต็มกลับมา
-- กติกาใหม่:
--   - ต้องล็อกอิน และต้องเป็นหัวหน้าของกลุ่มที่ยังไม่ถูกเก็บเข้าคลังอย่างน้อยหนึ่งกลุ่ม
--     (ฟังก์ชันนี้ใช้ตอนหัวหน้าเพิ่มสมาชิกด้วยอีเมลเท่านั้น)
--   - คืนค่าเหมือนเดิม: user_id, full_name, email ไม่เกิน 1 แถว เทียบอีเมลแบบไม่สนตัวพิมพ์
-- ==============================================================================

BEGIN;

-- ลบฉบับเดิมทุก signature เพราะชนิดข้อมูลที่คืนอาจต่างจากฉบับใหม่
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'find_user_by_email'
    LOOP
        EXECUTE format('DROP FUNCTION %s', r.sig);
    END LOOP;
END $$;

CREATE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE(user_id uuid, full_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.group_members gm
    join public.groups g on g.group_id = gm.group_id
    where gm.user_id = auth.uid()
      and gm.role = 'leader'
      and g.archived_at is null
  ) then
    raise exception 'only a group leader can search users by email';
  end if;

  return query
  select u.user_id, u.full_name::text, u.email::text
  from public.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
end $function$;

REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็นสิทธิ์ EXECUTE เฉพาะ authenticated (และ postgres/service_role)
-- ==============================================================================
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'find_user_by_email'
ORDER BY grantee;
