-- ==============================================================================
-- โอนตำแหน่งหัวหน้ากลุ่ม (ต้องให้สมาชิกที่ถูกเสนอตอบรับก่อน ไม่บังคับ)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- กติกา (ทำผ่าน RPC แบบ security definer ทั้งหมด หน้าเว็บไม่ได้แก้ตารางเอง):
--   - request_leader_transfer(p_group_id, p_user_id): หัวหน้าเสนอให้สมาชิกคนหนึ่งเป็นหัวหน้า
--     ส่ง p_user_id = null เพื่อยกเลิกคำขอ มีคำขอค้างได้ทีละคน
--   - respond_leader_transfer(p_group_id, p_accept): คนที่ถูกเสนอตอบรับหรือปฏิเสธ
--     ถ้าตอบรับ: หัวหน้าเดิมเป็น member, คนนี้เป็น leader และ groups.created_by เปลี่ยนเป็นคนนี้
--     (policy แก้ไขกลุ่มและหน้า "หัวหน้า" อิง created_by จึงต้องย้ายตาม)
--   - หน้าเว็บบันทึก leader_transferred หลังตอบรับสำเร็จ (คนรับเป็นสมาชิกอยู่แล้วจึงบันทึกได้)
-- ==============================================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS pending_leader_id uuid REFERENCES public.users(user_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.request_leader_transfer(p_group_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_role text;
begin
  if not public.is_group_leader(p_group_id) then
    raise exception 'only the group leader can transfer leadership';
  end if;

  if p_user_id is not null then
    select role into v_role from public.group_members
    where group_id = p_group_id and user_id = p_user_id;
    if not found then
      raise exception 'this user is not a member of the group';
    end if;
    if v_role = 'leader' then
      raise exception 'this user is already the leader';
    end if;
  end if;

  update public.groups set pending_leader_id = p_user_id where group_id = p_group_id;
end $function$;

CREATE OR REPLACE FUNCTION public.respond_leader_transfer(p_group_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not exists (
    select 1 from public.groups where group_id = p_group_id and pending_leader_id = v_me
  ) then
    raise exception 'there is no leadership request for you in this group';
  end if;

  if p_accept then
    if not exists (
      select 1 from public.group_members where group_id = p_group_id and user_id = v_me
    ) then
      raise exception 'you are no longer a member of this group';
    end if;

    update public.group_members set role = 'member'
    where group_id = p_group_id and role = 'leader';

    update public.group_members set role = 'leader'
    where group_id = p_group_id and user_id = v_me;

    update public.groups set created_by = v_me where group_id = p_group_id;
  end if;

  update public.groups set pending_leader_id = null where group_id = p_group_id;
end $function$;

REVOKE ALL ON FUNCTION public.request_leader_transfer(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_leader_transfer(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.respond_leader_transfer(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_leader_transfer(uuid, boolean) TO authenticated;

-- ตรวจผล: ควรเห็นฟังก์ชัน 2 แถว และคอลัมน์ pending_leader_id 1 แถว
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('request_leader_transfer', 'respond_leader_transfer');
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'pending_leader_id';
