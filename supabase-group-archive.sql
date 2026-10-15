-- ==============================================================================
-- ลบกลุ่มแบบเก็บเข้าคลัง (archive)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรัน supabase-leader-transfer.sql ก่อน (ใช้คอลัมน์ pending_leader_id)
--
-- กติกา:
--   - ไม่ลบข้อมูลจริง ตั้ง groups.archived_at แล้วหน้าเว็บซ่อนกลุ่มนี้ทุกที่
--   - งาน สมาชิก ผลประเมิน และประวัติกิจกรรมเก็บไว้ทั้งหมด
--   - เรียกได้เฉพาะหัวหน้ากลุ่ม และล้างคำขอโอนหัวหน้าที่ค้างอยู่
--   - หน้าเว็บบันทึก group_deleted หลัง RPC สำเร็จ (หัวหน้ายังเป็นสมาชิกอยู่)
-- ==============================================================================

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.archive_group(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid() and role = 'leader'
  ) then
    raise exception 'only the group leader can delete this group';
  end if;

  update public.groups
  set archived_at = now(), pending_leader_id = null
  where group_id = p_group_id and archived_at is null;

  if not found then
    raise exception 'this group has already been deleted';
  end if;
end $function$;

REVOKE ALL ON FUNCTION public.archive_group(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_group(uuid) TO authenticated;

-- ตรวจผล: ควรเห็นคอลัมน์ archived_at 1 แถว และฟังก์ชัน archive_group 1 แถว
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'archived_at';
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'archive_group';
