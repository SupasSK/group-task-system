"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase";
import Sidebar from "@/components/dashboard/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // เชื่อมต่อ Supabase ไม่ได้ (ต่างจากยังไม่ล็อกอิน) แสดงข้อความแทนการเด้งไปหน้า login
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!user) {
        if (isAuthRetryableFetchError(error)) {
          setConnectionError(true);
          return;
        }
        router.push("/login");
        return;
      }
      // ชื่อที่ผู้ใช้ตั้งเองอยู่ใน public.users (user_metadata ถูกทับด้วยชื่อจาก Google ทุกครั้งที่ล็อกอิน)
      const { data: row } = await supabase
        .from("users")
        .select("full_name, avatar_url, custom_avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      const metaName =
        row?.full_name || (user.user_metadata?.full_name as string) || user.email?.split('@')[0];
      setDisplayName(metaName || "");
      setAvatarUrl(row?.custom_avatar_url || row?.avatar_url || null);
    };
    load();

    // หน้าโปรไฟล์แจ้งเมื่อบันทึกชื่อใหม่ ให้ Sidebar เปลี่ยนตามทันที
    const onProfileUpdated = (e: Event) => setDisplayName((e as CustomEvent<string>).detail);
    window.addEventListener("profile-updated", onProfileUpdated);
    // หน้าโปรไฟล์แจ้งเมื่ออัปโหลด/ลบรูป (detail = รูปที่ต้องแสดงตอนนี้)
    const onAvatarUpdated = (e: Event) => setAvatarUrl((e as CustomEvent<string | null>).detail);
    window.addEventListener("avatar-updated", onAvatarUpdated);
    return () => {
      window.removeEventListener("profile-updated", onProfileUpdated);
      window.removeEventListener("avatar-updated", onAvatarUpdated);
    };
  }, [router, supabase]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4f6fb] md:flex-row">
      <Suspense fallback={<aside className="gt-gradient hidden w-[220px] h-screen shrink-0 md:block" />}>
        <Sidebar displayName={displayName} avatarUrl={avatarUrl} />
      </Suspense>
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
        {connectionError && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
            เชื่อมต่อระบบไม่สำเร็จ ข้อมูลที่แสดงอาจไม่ครบ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้านี้
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
