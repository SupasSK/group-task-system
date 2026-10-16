-- KPI-5 รอบที่ 1: แก้ประวัติกิจกรรมโดยเจตนา เฉพาะกลุ่มทดสอบ [TEST] KPI-5 edit r1, [TEST] KPI-5 delete r1, [TEST] KPI-5 insert r1
-- รันทั้งไฟล์ใน Supabase SQL Editor ครั้งเดียว (ปิด trigger ของ activity_logs ชั่วคราวในธุรกรรมนี้เท่านั้น แล้วเปิดคืน)
begin;
alter table public.activity_logs disable trigger user;

-- (1) แก้ payload ของแถวลำดับที่ 5 โดยไม่คำนวณ hash ใหม่
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb
where seq = 5 and group_id = (select group_id from public.groups where group_name = '[TEST] KPI-5 edit r1');

-- (2) ลบแถวลำดับที่ 5
delete from public.activity_logs
where seq = 5 and group_id = (select group_id from public.groups where group_name = '[TEST] KPI-5 delete r1');

-- (3) แทรกแถวปลอมต่อท้าย โดยไม่รู้วิธีคำนวณ hash
insert into public.activity_logs (group_id, seq, actor_id, action_type, entity_type, entity_id, payload, created_at, prev_hash, hash)
select l.group_id, l.seq + 1, l.actor_id, 'comment_added', l.entity_type, l.entity_id,
       '{"title": "KPI-5", "preview": "แถวปลอม"}'::jsonb, now(), l.hash, md5(random()::text)
from public.activity_logs l
where l.group_id = (select group_id from public.groups where group_name = '[TEST] KPI-5 insert r1')
order by l.seq desc limit 1;

alter table public.activity_logs enable trigger user;
commit;

-- ให้งานตรวจอัตโนมัติ (A09) บันทึกผลทันที ไม่ต้องรอรอบ 01:00 น.
select public.run_integrity_checks() as groups_checked;

-- ตรวจผล: control ต้อง true, ที่เหลือต้อง false
select g.group_name, v.is_valid, v.broken_at_seq
from public.groups g, lateral public.verify_activity_chain(g.group_id) v
where g.group_name like '[TEST] KPI-5 % r1'
order by g.group_name;
