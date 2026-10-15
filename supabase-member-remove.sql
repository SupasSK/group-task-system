-- ==============================================================================
-- ให้หัวหน้ากลุ่มนำสมาชิกออกจากกลุ่ม
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรัน supabase-task-collaborators.sql ก่อน
--
-- กติกา (ทำทั้งหมดในธุรกรรมเดียวผ่าน RPC remove_group_member):
--   - เรียกได้เฉพาะหัวหน้าของกลุ่ม และนำหัวหน้าออกไม่ได้
--   - งานที่ยังไม่เสร็จซึ่งคนนี้เป็นผู้รับผิดชอบหลัก -> status 'pending', assigned_to null
--   - ลบแถวผู้ร่วมทำของคนนี้เฉพาะงานที่ยังไม่เสร็จ
--     (งานที่เสร็จแล้วเก็บไว้ เพื่อไม่ให้คะแนนการมีส่วนร่วมของคนอื่นเปลี่ยนย้อนหลัง)
--   - ผลประเมินเพื่อน ฟีดแบค และประวัติกิจกรรมเก็บไว้ทั้งหมด
--   - หน้าเว็บบันทึก member_removed หลังเรียก RPC สำเร็จ
-- ==============================================================================

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
  set status = 'pending', assigned_to = null, updated_at = now()
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

-- ตรวจผล: ควรเห็นฟังก์ชัน remove_group_member 1 แถว
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'remove_group_member';
