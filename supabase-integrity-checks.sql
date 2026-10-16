-- ==============================================================================
-- ตรวจสายบันทึกกิจกรรม (hash chain) อัตโนมัติทุกวัน และเก็บผลให้หน้าเว็บแจ้งเตือน (OWASP A09, KPI-9 เกณฑ์ข้อ 5)
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- กติกา:
--   - run_integrity_checks() เรียก verify_activity_chain ของทุกกลุ่มที่ยังไม่เก็บเข้าคลัง แล้วเก็บผลใน integrity_checks
--     (verify_activity_chain ข้ามการตรวจสมาชิกเมื่อไม่มีผู้ใช้ จึงเรียกจากงานตั้งเวลาได้)
--   - pg_cron เรียกทุกวันเวลา 01:00 น. (เวลาประเทศไทย = 18:00 UTC)
--   - สมาชิกกลุ่มอ่านผลของกลุ่มตัวเองได้ ไม่มีใครเขียนผลได้นอกจากฟังก์ชันนี้
--   - หน้ากลุ่มแสดงแถบเตือนสีแดงเมื่อผลตรวจล่าสุดของกลุ่มไม่ผ่าน (components/dashboard/IntegrityAlert.tsx)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

BEGIN;

CREATE TABLE IF NOT EXISTS public.integrity_checks (
    check_id BIGSERIAL PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES public.groups(group_id) ON DELETE CASCADE,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_valid BOOLEAN NOT NULL,
    broken_at_seq BIGINT
);
CREATE INDEX IF NOT EXISTS integrity_checks_group_idx ON public.integrity_checks (group_id, checked_at DESC);

ALTER TABLE public.integrity_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read integrity checks" ON public.integrity_checks;
CREATE POLICY "members read integrity checks"
ON public.integrity_checks FOR SELECT TO authenticated
USING (is_group_member(group_id));
REVOKE INSERT, UPDATE, DELETE ON public.integrity_checks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_integrity_checks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  g record;
  v record;
  n int := 0;
begin
  for g in select group_id from public.groups where archived_at is null loop
    select * into v from public.verify_activity_chain(g.group_id);
    insert into public.integrity_checks (group_id, is_valid, broken_at_seq)
    values (g.group_id, v.is_valid, v.broken_at_seq);
    n := n + 1;
  end loop;
  return n;
end $function$;

REVOKE ALL ON FUNCTION public.run_integrity_checks() FROM public, anon, authenticated;

COMMIT;

-- ตั้งเวลา (ลบงานเดิมชื่อเดียวกันก่อน เพื่อให้รันซ้ำได้)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'daily-activity-chain-check';
SELECT cron.schedule('daily-activity-chain-check', '0 18 * * *', 'select public.run_integrity_checks()');

-- ==============================================================================
-- ตรวจผล: ควรเห็นงาน daily-activity-chain-check 1 แถว และรันตรวจครั้งแรกได้จำนวนกลุ่มที่ใช้งานอยู่
-- ==============================================================================
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'daily-activity-chain-check';
SELECT public.run_integrity_checks() AS groups_checked;
