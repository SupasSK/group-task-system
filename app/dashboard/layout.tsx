"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase";
import Sidebar from "@/components/dashboard/Sidebar";
import { DEMO_USER } from "@/lib/mock-data";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [displayName, setDisplayName] = useState(DEMO_USER.name);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const metaName = (user.user_metadata?.full_name as string) || user.email?.split('@')[0];
      setDisplayName(metaName || DEMO_USER.name);
    };
    load();
  }, [router, supabase]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4f6fb] md:flex-row">
      <Suspense fallback={<aside className="gt-gradient hidden w-[260px] h-screen shrink-0 md:block" />}>
        <Sidebar displayName={displayName} />
      </Suspense>
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">{children}</main>
    </div>
  );
}
