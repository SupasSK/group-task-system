-- ==============================================================================
-- การประเมินโดยเพื่อน (peer evaluation) แบบเป็นรอบ
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- กติกา:
--   - หัวหน้ากลุ่มเปิด/ปิดรอบ หัวหน้าไม่ประเมินและไม่ถูกประเมิน
--   - สมาชิกประเมินเพื่อนสมาชิกคนอื่น 3 ด้าน คะแนน 1-5 พร้อมคำบรรยาย
--   - ไม่มีใครอ่านแถวคะแนนของคนอื่นได้โดยตรง หัวหน้าเห็นเฉพาะค่าเฉลี่ยและคำบรรยาย
--     ที่ไม่ระบุผู้เขียน ผ่านฟังก์ชัน get_peer_eval_results หลังปิดรอบแล้วเท่านั้น
--     และเฉพาะคนที่มีผู้ประเมินอย่างน้อย 2 คน
-- ==============================================================================

BEGIN;

-- 1. รอบการประเมิน
CREATE TABLE IF NOT EXISTS public.eval_rounds (
    round_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- 2. คะแนนที่สมาชิกให้เพื่อน (1 แถวต่อ ผู้ประเมิน-ผู้ถูกประเมิน-รอบ)
CREATE TABLE IF NOT EXISTS public.peer_evaluations (
    evaluation_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    round_id UUID NOT NULL REFERENCES public.eval_rounds(round_id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
    evaluator_id UUID NOT NULL REFERENCES auth.users(id),
    evaluatee_id UUID NOT NULL REFERENCES auth.users(id),
    responsibility SMALLINT NOT NULL CHECK (responsibility BETWEEN 1 AND 5),
    quality SMALLINT NOT NULL CHECK (quality BETWEEN 1 AND 5),
    teamwork SMALLINT NOT NULL CHECK (teamwork BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (round_id, evaluator_id, evaluatee_id),
    CHECK (evaluator_id <> evaluatee_id)
);

ALTER TABLE public.eval_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_evaluations ENABLE ROW LEVEL SECURITY;

-- 3. Policies ของ eval_rounds
DROP POLICY IF EXISTS "members read eval rounds" ON public.eval_rounds;
CREATE POLICY "members read eval rounds"
ON public.eval_rounds FOR SELECT TO authenticated
USING (is_group_member(group_id));

DROP POLICY IF EXISTS "leader opens eval round" ON public.eval_rounds;
CREATE POLICY "leader opens eval round"
ON public.eval_rounds FOR INSERT TO authenticated
WITH CHECK (is_group_leader(group_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "leader closes eval round" ON public.eval_rounds;
CREATE POLICY "leader closes eval round"
ON public.eval_rounds FOR UPDATE TO authenticated
USING (is_group_leader(group_id))
WITH CHECK (is_group_leader(group_id));

-- 4. Policies ของ peer_evaluations
--    อ่านได้เฉพาะแถวที่ตัวเองเป็นผู้ประเมิน (ไม่มี policy ให้หัวหน้าอ่านแถวดิบ)
DROP POLICY IF EXISTS "evaluator reads own evaluations" ON public.peer_evaluations;
CREATE POLICY "evaluator reads own evaluations"
ON public.peer_evaluations FOR SELECT TO authenticated
USING (evaluator_id = auth.uid());

--    ส่งได้เมื่อ: เป็นสมาชิก (ไม่ใช่หัวหน้า), รอบยังเปิดและเป็นของกลุ่มนี้,
--    และผู้ถูกประเมินเป็นสมาชิก (ไม่ใช่หัวหน้า) ของกลุ่มเดียวกัน
--    ไม่มี policy UPDATE/DELETE จึงแก้หรือลบคะแนนที่ส่งแล้วไม่ได้
DROP POLICY IF EXISTS "member submits evaluation" ON public.peer_evaluations;
CREATE POLICY "member submits evaluation"
ON public.peer_evaluations FOR INSERT TO authenticated
WITH CHECK (
    evaluator_id = auth.uid()
    AND is_group_member(group_id)
    AND NOT is_group_leader(group_id)
    AND EXISTS (
        SELECT 1 FROM public.eval_rounds r
        WHERE r.round_id = peer_evaluations.round_id
        AND r.group_id = peer_evaluations.group_id
        AND r.status = 'open'
    )
    AND EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = peer_evaluations.group_id
        AND gm.user_id = peer_evaluations.evaluatee_id
        AND gm.role = 'member'
    )
);

-- 5. ผลการประเมินสำหรับหัวหน้า: ค่าเฉลี่ยรายคน + คำบรรยายที่สลับลำดับและไม่ระบุผู้เขียน
CREATE OR REPLACE FUNCTION public.get_peer_eval_results(p_round_id uuid)
RETURNS TABLE(
    evaluatee_id uuid,
    responses int,
    avg_responsibility numeric,
    avg_quality numeric,
    avg_teamwork numeric,
    comments text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_group uuid;
  v_status text;
begin
  select r.group_id, r.status into v_group, v_status
  from public.eval_rounds r where r.round_id = p_round_id;

  if v_group is null or not public.is_group_leader(v_group) then
    raise exception 'only the group leader can view results';
  end if;
  if v_status <> 'closed' then
    raise exception 'round is still open';
  end if;

  return query
  select e.evaluatee_id,
         count(*)::int,
         round(avg(e.responsibility), 2),
         round(avg(e.quality), 2),
         round(avg(e.teamwork), 2),
         coalesce(
           array_agg(e.comment order by random())
             filter (where e.comment is not null and e.comment <> ''),
           '{}'::text[])
  from public.peer_evaluations e
  where e.round_id = p_round_id
  group by e.evaluatee_id
  -- ผู้ประเมินคนเดียวจะถูกเดาได้ว่าใครให้คะแนน จึงไม่คืนผลของคนนั้น
  having count(*) >= 2;
end $function$;

-- 6. จำนวนสมาชิกที่ส่งแบบประเมินแล้วในรอบหนึ่ง (ไม่บอกว่าใคร) ให้สมาชิกกลุ่มดูได้
CREATE OR REPLACE FUNCTION public.peer_eval_submitted_count(p_round_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_group uuid;
begin
  select r.group_id into v_group from public.eval_rounds r where r.round_id = p_round_id;
  if v_group is null or not public.is_group_member(v_group) then
    raise exception 'not a member of this group';
  end if;
  return (select count(distinct e.evaluator_id)::int
          from public.peer_evaluations e where e.round_id = p_round_id);
end $function$;

COMMIT;

-- ==============================================================================
-- ตรวจผล: ควรเห็น policy 3 ตัวของ eval_rounds และ 2 ตัวของ peer_evaluations
-- ==============================================================================
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('eval_rounds', 'peer_evaluations')
ORDER BY tablename, cmd;
