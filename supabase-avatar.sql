-- ==============================================================================
-- รูปโปรไฟล์: รูปจาก Google + รูปที่ผู้ใช้อัปโหลดเอง
-- ให้นำโค้ดนี้ไปรันใน Supabase Dashboard -> SQL Editor (รันซ้ำได้)
--
-- - users.avatar_url        = รูปจาก Google (คัดลอกจาก auth.users ด้วย trigger)
-- - users.custom_avatar_url = รูปที่อัปโหลดเอง (แสดงก่อนรูป Google)
-- - bucket "avatars" (อ่านได้สาธารณะ) ไฟล์อยู่ในโฟลเดอร์ <user_id>/
--   ผู้ใช้อัปโหลด/ลบได้เฉพาะโฟลเดอร์ของตัวเอง จำกัด 2 MB เฉพาะไฟล์รูป
-- ==============================================================================

BEGIN;

-- 1) คอลัมน์รูปที่อัปโหลดเอง + ให้ผู้ใช้แก้ได้ (เดิมแก้ได้เฉพาะ full_name)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS custom_avatar_url text;
GRANT UPDATE (full_name, custom_avatar_url) ON public.users TO authenticated;

-- 2) คัดลอกรูป Google ของผู้ใช้ที่มีอยู่แล้ว
UPDATE public.users u
SET avatar_url = COALESCE(a.raw_user_meta_data->>'avatar_url', a.raw_user_meta_data->>'picture')
FROM auth.users a
WHERE a.id = u.user_id
  AND COALESCE(a.raw_user_meta_data->>'avatar_url', a.raw_user_meta_data->>'picture') IS NOT NULL;

-- 3) คัดลอกรูป Google ทุกครั้งที่ข้อมูลผู้ใช้เปลี่ยน (ล็อกอิน Google จะอัปเดต metadata)
--    ชื่อ trigger ขึ้นต้น zz_ เพื่อให้ทำงานหลัง trigger ที่สร้างแถว public.users ของผู้ใช้ใหม่
CREATE OR REPLACE FUNCTION public.sync_google_avatar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');
BEGIN
  IF v_url IS NOT NULL THEN
    UPDATE public.users
    SET avatar_url = v_url
    WHERE user_id = NEW.id AND avatar_url IS DISTINCT FROM v_url;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_sync_google_avatar ON auth.users;
CREATE TRIGGER zz_sync_google_avatar
AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_google_avatar();

-- 4) ที่เก็บไฟล์รูป
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 5) สิทธิ์ไฟล์: เฉพาะโฟลเดอร์ <user_id>/ ของตัวเอง (การลบไฟล์ต้องมีสิทธิ์ SELECT ด้วย)
DROP POLICY IF EXISTS "avatar select own" ON storage.objects;
CREATE POLICY "avatar select own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar insert own" ON storage.objects;
CREATE POLICY "avatar insert own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar delete own" ON storage.objects;
CREATE POLICY "avatar delete own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;

-- ==============================================================================
-- ตรวจผล: has_google_avatar ควรเป็น true สำหรับบัญชีที่ล็อกอินด้วย Google
-- ==============================================================================
SELECT email, avatar_url IS NOT NULL AS has_google_avatar, custom_avatar_url
FROM public.users
ORDER BY email;
