-- ==============================================================================
-- บังคับเหตุผลที่ฐานข้อมูลเมื่อหัวหน้าแก้กำหนดส่ง คนทำ หรือความยากของงาน (OWASP A06, KPI-9 เกณฑ์ข้อ 5)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรันก่อนที่หน้าเว็บจะส่งคอลัมน์ change_reason (commit ถัดไปของ TaskEditModal)
--
-- ปัญหาเดิม: หน้าเว็บ (TaskEditModal) บังคับใส่เหตุผล แต่หัวหน้าที่เรียก API ตรงแก้ได้โดยไม่มีเหตุผล
-- กติกาใหม่:
--   - หน้าเว็บส่งเหตุผลมาในคอลัมน์ tasks.change_reason พร้อมการแก้ไขครั้งนั้น
--   - ถ้าหัวหน้าแก้ deadline / assigned_to / difficulty ของงานที่ยังไม่เสร็จโดยไม่มีเหตุผล ฐานข้อมูลปฏิเสธ
--   - ยกเว้น: งานที่ถูกปฏิเสธ (มอบหมายใหม่โดยใช้การปฏิเสธเป็นเหตุผล), หัวหน้ารับงานว่างให้ตัวเอง,
--     และการแก้จาก SQL Editor (ไม่มีผู้ใช้)
--   - change_reason ไม่ถูกเก็บค้าง (ล้างเป็น null ทุกครั้ง) เหตุผลที่ใช้แสดงอยู่ใน activity_logs ตามเดิม
--   - remove_group_member ใส่เหตุผลให้เองตอนคืนงานของคนที่ถูกนำออก
-- ==============================================================================

BEGIN;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS change_reason TEXT;

CREATE OR REPLACE FUNCTION public.tasks_require_change_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null
     and old.status not in ('completed', 'rejected')
     and public.is_group_leader(old.group_id)
     and (new.deadline is distinct from old.deadline
          or new.difficulty is distinct from old.difficulty
          or (new.assigned_to is distinct from old.assigned_to
              and not (old.assigned_to is null and new.assigned_to = auth.uid())))
     and coalesce(btrim(new.change_reason), '') = '' then
    raise exception 'a reason is required to change the deadline, assignee or difficulty';
  end if;

  new.change_reason := null;
  return new;
end $function$;

DROP TRIGGER IF EXISTS tasks_require_change_reason ON public.tasks;
CREATE TRIGGER tasks_require_change_reason
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_require_change_reason();

-- remove_group_member ฉบับเดิม (supabase-member-remove.sql) เพิ่มเหตุผลตอนคืนงาน
CREATE OR REPLACE FUNCTION public.remove_group_member(p_group_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_unassigned int;
begin
  if not public.is_group_leader(p_group_id) then
    raise exception 'only the group leader can remove members';
  end if;

  select role into v_role from public.group_members
  where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'this user is not a member of the group';
  end if;
  if v_role = 'leader' then
    raise exception 'the group leader cannot be removed';
  end if;

  update public.tasks
  set status = 'pending', assigned_to = null, updated_at = now(), change_reason = 'ผู้รับผิดชอบถูกนำออกจากกลุ่ม'
  where group_id = p_group_id and assigned_to = p_user_id and status <> 'completed';
  get diagnostics v_unassigned = row_count;

  delete from public.task_collaborators c
  using public.tasks t
  where c.task_id = t.task_id
    and c.group_id = p_group_id
    and c.user_id = p_user_id
    and t.status <> 'completed';

  delete from public.group_members
  where group_id = p_group_id and user_id = p_user_id;

  return v_unassigned;
end $function$;

REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็น trigger tasks_require_change_reason และ tasks_guard_leader_fields บนตาราง tasks
-- ==============================================================================
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal ORDER BY tgname;
