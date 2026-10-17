-- ลบตารางและคอลัมน์ที่ไม่มีโค้ดใช้ (ตรวจเมื่อ 17 ต.ค. 2569)
-- user_stats: 0 แถว ไม่มีฟังก์ชัน trigger หรือ foreign key จากตารางอื่นอ้างถึง
-- tasks.category, tasks.start_date: ไม่มีโค้ดอ่านหรือเขียน
-- ถ้ามีฟังก์ชันในฐานข้อมูลอ้างถึงชื่อเหล่านี้ สคริปต์จะหยุดและไม่ลบอะไรเลย
-- ไม่ใช้ CASCADE: ถ้ามี view หรือ constraint ผูกอยู่ คำสั่ง drop จะ error แทนการลบตาม

begin;

do $$
declare
  refs text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ')
    into refs
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and (p.prosrc ilike '%user_stats%'
      or p.prosrc ~* '\mcategory\M'
      or p.prosrc ~* '\mstart_date\M');
  if refs is not null then
    raise exception 'หยุด: มีฟังก์ชันอ้างถึงตาราง/คอลัมน์ที่จะลบ: %', refs;
  end if;
end $$;

drop table if exists public.user_stats;
alter table public.tasks drop column if exists category;
alter table public.tasks drop column if exists start_date;

commit;

-- ตรวจผล: ควรไม่มี category และ start_date
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'tasks'
order by ordinal_position;
