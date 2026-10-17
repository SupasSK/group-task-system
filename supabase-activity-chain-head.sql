-- ==============================================================================
-- จุดยึดปลายสายบันทึกกิจกรรม (chain head) ให้ verify_activity_chain จับการลบแถวท้ายสายได้ (KPI-2b แบบที่ 8)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- ปัญหาเดิม: verify_activity_chain ตรวจแค่ว่าแถวที่เหลือต่อกันถูกต้อง ถ้าลบแถวท้ายสาย (หรือลบทั้งหมด)
--   แถวที่เหลือยังต่อกันครบ จึงรายงานว่าสมบูรณ์
-- กติกา:
--   - activity_heads เก็บ seq และ hash ของแถวล่าสุดของแต่ละกลุ่ม อัปเดตโดย trigger หลัง insert activity_logs เท่านั้น
--   - เปิด RLS โดยไม่มี policy และถอนสิทธิ์ทั้งหมดจาก anon / authenticated: ผ่าน API อ่านหรือแก้ไม่ได้เลย
--   - verify_activity_chain เทียบแถวสุดท้ายของสายกับ activity_heads เพิ่ม ถ้าไม่ตรงคืน false
--     broken_at_seq = ลำดับแรกที่หายไป (ลบท้าย) หรือแถวแรกที่เกินมา (แทรกท้าย)
--   - ถ้าปิด trigger ของ activity_logs แล้วลบ / แทรกแถว จุดยึดจะไม่ขยับตาม จึงตรวจพบ
-- ขอบเขต: สูตร hash (activity_compute_hash) ไม่มีกุญแจลับ ผู้ที่เข้าถึงฐานข้อมูลได้ทั้งหมด (เช่น SQL Editor)
--   คำนวณ hash ใหม่ทั้งสายและแก้ activity_heads ให้ตรงได้ ระบบนี้ไม่ป้องกันผู้ดูแลฐานข้อมูล
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_heads (
    group_id UUID PRIMARY KEY REFERENCES public.groups(group_id) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    hash TEXT NOT NULL
);
ALTER TABLE public.activity_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_heads FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.activity_logs_update_head()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.activity_heads (group_id, seq, hash)
  values (new.group_id, new.seq, new.hash)
  on conflict (group_id) do update set seq = excluded.seq, hash = excluded.hash
  where public.activity_heads.seq < excluded.seq;
  return null;
end $function$;

DROP TRIGGER IF EXISTS activity_logs_update_head ON public.activity_logs;
CREATE TRIGGER activity_logs_update_head
AFTER INSERT ON public.activity_logs
FOR EACH ROW EXECUTE FUNCTION public.activity_logs_update_head();

-- ตั้งจุดยึดให้กลุ่มที่มี log อยู่แล้ว จากแถวล่าสุดของแต่ละกลุ่ม
INSERT INTO public.activity_heads (group_id, seq, hash)
SELECT DISTINCT ON (group_id) group_id, seq, hash
FROM public.activity_logs
ORDER BY group_id, seq DESC
ON CONFLICT (group_id) DO UPDATE SET seq = excluded.seq, hash = excluded.hash;

-- ฉบับเดิมทุกบรรทัด เพิ่มเฉพาะการเทียบกับ activity_heads หลังวนครบ
CREATE OR REPLACE FUNCTION public.verify_activity_chain(p_group_id uuid)
RETURNS TABLE(is_valid boolean, broken_at_seq bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  r record;
  v_prev text := null;
  v_seq  bigint := 0;
  v_head_seq  bigint;
  v_head_hash text;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of this group';
  end if;

  for r in select * from public.activity_logs
           where group_id = p_group_id order by seq loop
    v_seq := v_seq + 1;
    if r.seq <> v_seq
       or r.prev_hash is distinct from v_prev
       or r.hash <> public.activity_compute_hash(
            r.prev_hash, r.seq, r.group_id, r.actor_id, r.action_type,
            r.entity_type, r.entity_id, r.payload, r.created_at)
    then
      return query select false, r.seq;
      return;
    end if;
    v_prev := r.hash;
  end loop;

  -- ปลายสายต้องตรงกับจุดยึด (กลุ่มที่ไม่มี log และไม่มีจุดยึด = 0 กับ null ตรงกัน)
  select h.seq, h.hash into v_head_seq, v_head_hash
  from public.activity_heads h where h.group_id = p_group_id;
  if coalesce(v_head_seq, 0) <> v_seq or v_head_hash is distinct from v_prev then
    return query select false, least(v_seq, coalesce(v_head_seq, 0)) + 1;
    return;
  end if;

  return query select true, null::bigint;
end $function$;

COMMIT;

-- ==============================================================================
-- ตรวจผล:
--   1) จำนวนกลุ่มที่มีจุดยึด ควรเท่ากับจำนวนกลุ่มที่มี log
--   2) ผลตรวจของทุกกลุ่มควรเหมือนก่อนรันสคริปต์ (กลุ่มที่เคยผ่านยังผ่าน กลุ่มทดสอบที่ถูกทำให้เสียไว้ยังไม่ผ่าน)
-- ==============================================================================
SELECT (SELECT count(*) FROM public.activity_heads) AS heads,
       (SELECT count(DISTINCT group_id) FROM public.activity_logs) AS groups_with_logs;

SELECT g.group_name, v.is_valid, v.broken_at_seq
FROM public.groups g, LATERAL public.verify_activity_chain(g.group_id) v
ORDER BY v.is_valid, g.group_name;
