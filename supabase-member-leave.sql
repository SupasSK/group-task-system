-- ==============================================================================
-- ให้สมาชิกออกจากกลุ่มเอง
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรัน supabase-task-collaborators.sql และ supabase-leader-transfer.sql ก่อน
--
-- กติกา (ทำทั้งหมดในธุรกรรมเดียวผ่าน RPC leave_group):
--   - เรียกได้เฉพาะสมาชิกของกลุ่ม หัวหน้าออกไม่ได้ (ต้องโอนหัวหน้าก่อน)
--   - จัดการงานเหมือน remove_group_member:
--     งานที่ยังไม่เสร็จซึ่งคนนี้เป็นผู้รับผิดชอบหลัก -> status 'pending', assigned_to null
--     ลบแถวผู้ร่วมทำของคนนี้เฉพาะงานที่ยังไม่เสร็จ
--   - ถ้ามีคำขอโอนหัวหน้าค้างอยู่ที่คนนี้ ให้ล้างคำขอ
--   - ผลประเมินเพื่อน ฟีดแบค และประวัติกิจกรรมเก็บไว้ทั้งหมด
--   - หน้าเว็บบันทึก member_left ก่อนเรียก RPC (หลังออกแล้วจะบันทึก log ไม่ได้)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_role text;
  v_unassigned int;
  v_claims text;
  v_sub text;
begin
  select role into v_role from public.group_members
  where group_id = p_group_id and user_id = v_me;
  if v_me is null or not found then
    raise exception 'you are not a member of this group';
  end if;
  if v_role = 'leader' then
    raise exception 'the leader must transfer leadership before leaving';
  end if;

  -- trigger tasks_guard_leader_fields ให้เฉพาะหัวหน้าปล่อยงานได้ (อิง auth.uid())
  -- จึงล้างตัวตนชั่วคราวให้ auth.uid() เป็น null (แบบเดียวกับแก้จาก SQL Editor) แล้วคืนค่าทันที
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  update public.tasks
  set status = 'pending', assigned_to = null, updated_at = now()
  where group_id = p_group_id and assigned_to = v_me and status <> 'completed';
  get diagnostics v_unassigned = row_count;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  delete from public.task_collaborators c
  using public.tasks t
  where c.task_id = t.task_id
    and c.group_id = p_group_id
    and c.user_id = v_me
    and t.status <> 'completed';

  update public.groups set pending_leader_id = null
  where group_id = p_group_id and pending_leader_id = v_me;

  delete from public.group_members
  where group_id = p_group_id and user_id = v_me;

  return v_unassigned;
end $function$;

REVOKE ALL ON FUNCTION public.leave_group(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

-- ตรวจผล: ควรเห็นฟังก์ชัน leave_group 1 แถว
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'leave_group';
