-- เกณฑ์ฉบับที่ 4 KPI-3 r1: แก้ประวัติกิจกรรมโดยเจตนา 10 แบบ เฉพาะกลุ่ม "[TEST] v4 KPI-3 <แบบ> r1" (กลุ่ม control ไม่แตะ)
-- รันทั้งไฟล์ใน Supabase SQL Editor ครั้งเดียว ปิด trigger ของ activity_logs ชั่วคราวในธุรกรรมนี้เท่านั้น แล้วเปิดคืน
-- (trigger ที่ปิดรวมถึง activity_logs_update_head จุดยึดปลายสายจึงไม่ขยับตามการแก้)
begin;
alter table public.activity_logs disable trigger user;

-- 1 edit-payload
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 edit-payload r1') and seq = 5;
-- 2 edit-actor (สลับผู้ทำระหว่างหัวหน้ากับสมาชิก)
update public.activity_logs set actor_id = case when actor_id = '8ce1be46-c51c-44df-8e36-61bffd784222' then '1f61dc3a-474d-4f24-82ad-482cb47192bb'::uuid else '8ce1be46-c51c-44df-8e36-61bffd784222'::uuid end where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 edit-actor r1') and seq = 5;
-- 3 edit-time
update public.activity_logs set created_at = created_at - interval '1 day' where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 edit-time r1') and seq = 5;
-- 4 edit-action
update public.activity_logs set action_type = 'decision_added' where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 edit-action r1') and seq = 5;
-- 5 rehash (ผู้แก้รู้สูตร hash แต่แก้เฉพาะแถวนี้)
update public.activity_logs set payload = payload || '{"tampered": true}'::jsonb where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 rehash r1') and seq = 5;
update public.activity_logs set hash = public.activity_compute_hash(prev_hash, seq, group_id, actor_id, action_type, entity_type, entity_id, payload, created_at) where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 rehash r1') and seq = 5;
-- 6 delete-first
delete from public.activity_logs where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 delete-first r1') and seq = 1;
-- 7 delete-mid
delete from public.activity_logs where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 delete-mid r1') and seq = 5;
-- 8 delete-last
delete from public.activity_logs where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 delete-last r1') and seq = 14;
-- 9 insert-mid: เลื่อน seq ตั้งแต่ 5 ขึ้นไป 1 ช่อง (ผ่าน +1000 เพื่อไม่ชนกัน) แล้วแทรกแถวปลอมที่ 5 ด้วย hash ที่คำนวณถูกต้อง
update public.activity_logs set seq = seq + 1000 where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 insert-mid r1') and seq >= 5;
update public.activity_logs set seq = seq - 999 where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 insert-mid r1') and seq >= 1000;
insert into public.activity_logs (group_id, seq, actor_id, action_type, entity_type, entity_id, payload, created_at, prev_hash, hash)
select l.group_id, 5, l.actor_id, 'comment_added', l.entity_type, l.entity_id, '{"title": "KPI-3", "preview": "แถวปลอม"}'::jsonb, l.created_at, l.hash,
       public.activity_compute_hash(l.hash, 5, l.group_id, l.actor_id, 'comment_added', l.entity_type, l.entity_id, '{"title": "KPI-3", "preview": "แถวปลอม"}'::jsonb, l.created_at)
from public.activity_logs l where l.group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 insert-mid r1') and l.seq = 4;
-- 10 swap
update public.activity_logs set seq = 1005 where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 swap r1') and seq = 5;
update public.activity_logs set seq = 5 where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 swap r1') and seq = 6;
update public.activity_logs set seq = 6 where group_id = (select group_id from public.groups where group_name = '[TEST] v4 KPI-3 swap r1') and seq = 1005;

alter table public.activity_logs enable trigger user;
commit;

-- ให้งานตรวจอัตโนมัติบันทึกผลทันที ไม่ต้องรอรอบ 01:00 น.
select public.run_integrity_checks() as groups_checked;

-- ตรวจผล: control ต้อง true ที่เหลือต้อง false
select g.group_name, v.is_valid, v.broken_at_seq
from public.groups g, lateral public.verify_activity_chain(g.group_id) v
where g.group_name like '[TEST] v4 KPI-3 % r1'
order by g.group_name;
