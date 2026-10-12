-- ==============================================================================
-- แก้ไขปัญหา: new row violates row-level security policy for table "groups"
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor
-- ลิงก์ตรง: https://supabase.com/dashboard/project/elnpjfjzyiheovpqzhsm/sql/new
-- ==============================================================================

-- 1. ตรวจสอบและสร้างตาราง groups (หากยังไม่มี)
CREATE TABLE IF NOT EXISTS public.groups (
    group_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_name TEXT NOT NULL,
    description TEXT,
    work_mode TEXT DEFAULT 'mixed',
    join_code TEXT UNIQUE,
    created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. ตรวจสอบและสร้างตาราง group_members (หากยังไม่มี)
CREATE TABLE IF NOT EXISTS public.group_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    group_id UUID REFERENCES public.groups(group_id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(group_id, user_id)
);

-- 3. เปิดใช้งาน Row Level Security (RLS)
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- 4. ล้าง Policies เดิมที่อาจทับซ้อนหรือขัดขวางการทำงาน
DROP POLICY IF EXISTS "Allow all for authenticated on groups" ON public.groups;
DROP POLICY IF EXISTS "Users can insert their own groups" ON public.groups;
DROP POLICY IF EXISTS "Users can view groups" ON public.groups;
DROP POLICY IF EXISTS "Users can update groups" ON public.groups;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.groups;

DROP POLICY IF EXISTS "Allow all for authenticated on group_members" ON public.group_members;
DROP POLICY IF EXISTS "Users can insert group members" ON public.group_members;
DROP POLICY IF EXISTS "Users can view group members" ON public.group_members;

-- 5. สร้าง Policies สำหรับตาราง groups
-- อนุญาตให้สมาชิกที่ล็อกอิน (authenticated) ทำการ SELECT, INSERT, UPDATE, DELETE ได้อย่างถูกต้อง
CREATE POLICY "Allow authenticated users to insert groups"
ON public.groups
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Allow authenticated users to view groups"
ON public.groups
FOR SELECT
TO authenticated
USING (
    created_by = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE public.group_members.group_id = public.groups.group_id
        AND public.group_members.user_id = auth.uid()
    )
);

CREATE POLICY "Allow group creator to update groups"
ON public.groups
FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Allow group creator to delete groups"
ON public.groups
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- 6. สร้าง Policies สำหรับตาราง group_members
CREATE POLICY "Allow authenticated users to insert group_members"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.groups
        WHERE public.groups.group_id = public.group_members.group_id
        AND public.groups.created_by = auth.uid()
    )
);

CREATE POLICY "Allow authenticated users to view group_members"
ON public.group_members
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated users to update group_members"
ON public.group_members
FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
    OR EXISTS (
        SELECT 1 FROM public.groups
        WHERE public.groups.group_id = public.group_members.group_id
        AND public.groups.created_by = auth.uid()
    )
);

-- ==============================================================================
-- สำเร็จ! เมื่อรันสคริปต์นี้แล้ว ระบบจะสามารถสร้างกลุ่มและเพิ่มสมาชิกลงฐานข้อมูลได้ทันที
-- ==============================================================================
