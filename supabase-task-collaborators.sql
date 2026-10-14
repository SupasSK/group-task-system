-- ==============================================================================
-- งานที่ทำหลายคน (ผู้รับผิดชอบหลัก + ผู้ร่วมทำ) และฟีดแบคหลังทำงานเสร็จ
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
-- ต้องรัน supabase-task-difficulty.sql ก่อน
--
-- กติกา:
--   - tasks.headcount = จำนวนคนทั้งหมดของงาน (1-5) รวมผู้รับผิดชอบหลัก (assigned_to)
--   - ผู้ร่วมทำ (pending/accepted) มีได้ไม่เกิน headcount - 1 ที่ของคนหลักเว้นไว้เสมอ
--   - หัวหน้าเชิญผู้ร่วมทำ (pending) ผู้ถูกเชิญกดรับ/ปฏิเสธเอง
--   - งานแบบสมาชิกเลือกเอง: สมาชิกเข้าร่วมเองได้ (accepted ทันที)
--   - ผู้ร่วมทำที่รับแล้วแก้งานได้เหมือนคนหลัก ยกเว้นกด "เสร็จแล้ว"
--   - ฟีดแบคแบบเปิดชื่อ ส่งได้หลังงานเสร็จ ระหว่างคนที่ทำงานนั้นด้วยกัน
--     อ่านได้เฉพาะผู้ส่งและหัวหน้ากลุ่ม ส่งแล้วแก้หรือลบไม่ได้
-- ==============================================================================

BEGIN;

-- 1. จำนวนคนของงาน
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS headcount SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_headcount_check;
ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_headcount_check CHECK (headcount BETWEEN 1 AND 5);

-- 2. ผู้ร่วมทำ
CREATE TABLE IF NOT EXISTS public.task_collaborators (
    task_id UUID NOT NULL REFERENCES public.tasks(task_id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    PRIMARY KEY (task_id, user_id)
);

-- 3. ฟีดแบคหลังทำงานเสร็จ (1 แถวต่อ ผู้ให้-ผู้รับ-งาน)
CREATE TABLE IF NOT EXISTS public.task_feedback (
    feedback_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES public.tasks(task_id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
    from_user UUID NOT NULL REFERENCES auth.users(id),
    to_user UUID NOT NULL REFERENCES auth.users(id),
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, from_user, to_user),
    CHECK (from_user <> to_user)
);

ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_feedback ENABLE ROW LEVEL SECURITY;

-- 4. ฟังก์ชันช่วย (security definer เพื่อไม่ให้ policy อ้างตารางกันเองวนซ้ำ)
CREATE OR REPLACE FUNCTION public.is_task_collaborator(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.task_collaborators c
    where c.task_id = p_task_id and c.user_id = auth.uid() and c.status = 'accepted'
  );
$function$;

-- คนหลัก หรือผู้ร่วมทำที่รับงานแล้ว
CREATE OR REPLACE FUNCTION public.is_task_participant(p_task_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.tasks t where t.task_id = p_task_id and t.assigned_to = p_user_id)
      or exists (
        select 1 from public.task_collaborators c
        where c.task_id = p_task_id and c.user_id = p_user_id and c.status = 'accepted'
      );
$function$;

-- 5. ตรวจที่ว่างและความถูกต้องก่อนเพิ่มผู้ร่วมทำ
--    ล็อกแถวงานไว้ระหว่างนับ กันสองคนกดเข้าร่วมพร้อมกันจนเกินจำนวน
CREATE OR REPLACE FUNCTION public.task_collaborators_check_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_task public.tasks%rowtype;
  v_taken int;
begin
  select * into v_task from public.tasks where task_id = new.task_id for update;
  if not found then
    raise exception 'task not found';
  end if;
  if v_task.group_id <> new.group_id then
    raise exception 'group_id does not match the task';
  end if;
  if v_task.assigned_to = new.user_id then
    raise exception 'this member is already the main assignee';
  end if;
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = new.group_id and gm.user_id = new.user_id
  ) then
    raise exception 'collaborator must be a member of the group';
  end if;

  select count(*) into v_taken from public.task_collaborators c
  where c.task_id = new.task_id and c.status in ('pending', 'accepted');
  if v_taken >= v_task.headcount - 1 then
    raise exception 'no collaborator slots left for this task';
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS task_collaborators_check_slot ON public.task_collaborators;
CREATE TRIGGER task_collaborators_check_slot
BEFORE INSERT ON public.task_collaborators
FOR EACH ROW EXECUTE FUNCTION public.task_collaborators_check_slot();

-- 6. Policies ของ task_collaborators
DROP POLICY IF EXISTS "members read collaborators" ON public.task_collaborators;
CREATE POLICY "members read collaborators"
ON public.task_collaborators FOR SELECT TO authenticated
USING (is_group_member(group_id));

DROP POLICY IF EXISTS "leader invites collaborators" ON public.task_collaborators;
CREATE POLICY "leader invites collaborators"
ON public.task_collaborators FOR INSERT TO authenticated
WITH CHECK (is_group_leader(group_id) AND status = 'pending');

DROP POLICY IF EXISTS "member joins open task" ON public.task_collaborators;
CREATE POLICY "member joins open task"
ON public.task_collaborators FOR INSERT TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND status = 'accepted'
    AND is_group_member(group_id)
    AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.task_id = task_collaborators.task_id
        AND t.assignment_type = 'open_choice'
    )
);

DROP POLICY IF EXISTS "invitee responds" ON public.task_collaborators;
CREATE POLICY "invitee responds"
ON public.task_collaborators FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND status = 'pending')
WITH CHECK (user_id = auth.uid() AND status IN ('accepted', 'rejected'));

-- หัวหน้าเอาผู้ร่วมทำออก (เช่น แทนคนที่ปฏิเสธ) / ผู้ร่วมทำถอนตัวหรือเลื่อนเป็นคนหลัก
DROP POLICY IF EXISTS "leader or self removes collaborator" ON public.task_collaborators;
CREATE POLICY "leader or self removes collaborator"
ON public.task_collaborators FOR DELETE TO authenticated
USING (is_group_leader(group_id) OR user_id = auth.uid());

-- ผู้ถูกเชิญแก้ได้เฉพาะสถานะ เหตุผล และเวลาตอบ
REVOKE UPDATE ON public.task_collaborators FROM authenticated;
GRANT UPDATE (status, note, responded_at) ON public.task_collaborators TO authenticated;

-- 7. Policies ของ task_feedback
DROP POLICY IF EXISTS "sender or leader reads feedback" ON public.task_feedback;
CREATE POLICY "sender or leader reads feedback"
ON public.task_feedback FOR SELECT TO authenticated
USING (from_user = auth.uid() OR is_group_leader(group_id));

DROP POLICY IF EXISTS "participant sends feedback" ON public.task_feedback;
CREATE POLICY "participant sends feedback"
ON public.task_feedback FOR INSERT TO authenticated
WITH CHECK (
    from_user = auth.uid()
    AND is_task_participant(task_id, auth.uid())
    AND is_task_participant(task_id, to_user)
    AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.task_id = task_feedback.task_id
        AND t.group_id = task_feedback.group_id
        AND t.status = 'completed'
    )
);

-- 8. ผู้ร่วมทำที่รับงานแล้วแก้งานได้ (ข้อจำกัดเพิ่มเติมอยู่ใน trigger ข้อ 9)
DROP POLICY IF EXISTS "leader or assignee updates tasks" ON public.tasks;
CREATE POLICY "leader or assignee updates tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (is_group_leader(group_id) OR assigned_to = auth.uid() OR is_task_collaborator(task_id))
WITH CHECK (is_group_leader(group_id) OR assigned_to = auth.uid() OR is_task_collaborator(task_id));

-- 9. ฟิลด์ที่คนที่ไม่ใช่หัวหน้าแก้ไม่ได้ (รวมกติกาเดิมจาก supabase-task-difficulty.sql)
--    (auth.uid() เป็น null เมื่อแก้จาก SQL Editor จึงไม่ถูกบล็อก)
CREATE OR REPLACE FUNCTION public.tasks_guard_leader_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.is_group_leader(old.group_id) then
    return new;
  end if;

  if new.priority is distinct from old.priority
     or new.deadline is distinct from old.deadline
     or new.difficulty is distinct from old.difficulty
     or new.headcount is distinct from old.headcount then
    raise exception 'only the group leader can change priority, deadline, difficulty or headcount';
  end if;

  -- เปลี่ยนคนหลักได้เฉพาะตอนรับงานที่ยังไม่มีคนหลัก ให้ตัวเอง
  if new.assigned_to is distinct from old.assigned_to
     and not (old.assigned_to is null and new.assigned_to = auth.uid()) then
    raise exception 'only the group leader can change the main assignee';
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed'
     and old.assigned_to is distinct from auth.uid() then
    raise exception 'only the main assignee or the group leader can mark a task as completed';
  end if;

  return new;
end $function$;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็น policy 5 ตัวของ task_collaborators, 2 ตัวของ task_feedback
-- และ policy UPDATE ของ tasks ที่มี is_task_collaborator
-- ==============================================================================
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('task_collaborators', 'task_feedback', 'tasks')
ORDER BY tablename, cmd;
