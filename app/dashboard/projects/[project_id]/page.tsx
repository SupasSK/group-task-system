"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Users, Copy, Check, ArrowLeft } from "lucide-react";
import { PROJECTS, TEAM_MEMBERS } from "@/lib/mock-data";
import { createClient } from "@/utils/supabase";

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const projectId = String(params.project_id || "p1");
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

  const [dbGroup, setDbGroup] = useState<any>(null);
  const [dbMembers, setDbMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const mockProject = useMemo(
    () => PROJECTS.find((p) => p.id === projectId) || PROJECTS[0],
    [projectId]
  );

  useEffect(() => {
    if (isUUID) {
      router.replace(`/dashboard/groups/${projectId}`);
      return;
    }
    // ถ้าไม่ใช่ p1, p2 ให้โหลดจาก Supabase
    if (projectId && !projectId.startsWith("p")) {
      loadDbProject();
    }
  }, [projectId, isUUID, router]);

  const loadDbProject = async () => {
    setLoading(true);
    try {
      const { data: group } = await supabase
        .from("groups")
        .select("*")
        .eq("group_id", projectId)
        .single();

      if (group) {
        setDbGroup(group);

        // ดึงสมาชิก
        const { data: members } = await supabase
          .from("group_members")
          .select("*")
          .eq("group_id", projectId);

        setDbMembers(members || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const projectTitle = dbGroup ? dbGroup.group_name : mockProject.title;
  const projectDesc = dbGroup ? (dbGroup.description || "ไม่มีคำอธิบายโครงการ") : mockProject.description;
  const joinCode = dbGroup ? dbGroup.join_code : "ABC123";

  const [tab, setTab] = useState("สมาชิก");
  const [copied, setCopied] = useState(false);

  const memberCount = dbGroup ? Math.max(dbMembers.length, 1) : TEAM_MEMBERS.length;

  const tabs = [
    { id: "ภาพรวม", label: "ภาพรวม" },
    { id: "งานทั้งหมด", label: "งานทั้งหมด" },
    { id: "สมาชิก", label: `สมาชิก (${memberCount})` },
    { id: "สรุปผล", label: "สรุปผล" },
  ];

  const copyCode = () => {
    navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUUID) {
    return null;
  }

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-400 hover:text-indigo-600 transition"
        >
          <ArrowLeft size={16} />
          กลับหน้าแดชบอร์ด
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-[28px] font-bold text-slate-800">{projectTitle}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-400">
            {projectDesc}
          </p>
        </div>
        <div className="gt-card flex items-center gap-4 px-5 py-3 border border-indigo-100 bg-white">
          <div>
            <p className="text-[12px] text-slate-400">รหัสเข้าร่วม</p>
            <p className="text-[18px] font-bold tracking-wider text-indigo-600">{joinCode}</p>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:underline"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-500" />
                คัดลอกแล้ว
              </>
            ) : (
              <>
                <Copy size={14} />
                คัดลอก
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-8 border-b border-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === "งานทั้งหมด") {
                router.push("/dashboard/tasks");
                return;
              }
              setTab(item.id);
            }}
            className={`-mb-px pb-3 text-[14px] ${
              tab === item.id
                ? "border-b-2 border-indigo-500 font-semibold text-indigo-600"
                : "border-b-2 border-transparent text-slate-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "สมาชิก" && (
        <section className="gt-card p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-bold">สมาชิกโครงการ</h2>
              <p className="mt-1 text-[13px] text-slate-400">
                แสดงรายชื่อและบทบาทการทำงานของคนในกลุ่มทั้งหมด
              </p>
            </div>
            <Link href="/dashboard/tasks/new" className="gt-btn rounded-xl px-4 py-2.5 text-[14px]">
              <Plus size={16} />
              สร้างงานใหม่
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {dbGroup ? (
              <div className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-bold text-white bg-indigo-600">
                      👑
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-slate-800">ผู้สร้างโครงการ (หัวหน้า)</p>
                      <p className="text-[12px] text-slate-400">รหัสเข้าร่วมทีม: {joinCode}</p>
                    </div>
                  </div>
                  <span className="rounded-full px-3 py-1 text-[12px] font-semibold bg-rose-50 text-rose-500">
                    หัวหน้าโครงการ
                  </span>
                </div>
                {dbMembers.filter(m => m.role !== 'leader').map((m, idx) => (
                  <div key={m.id || idx} className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-bold text-white bg-emerald-500">
                        👤
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-slate-800">สมาชิก {idx + 1}</p>
                        <p className="text-[12px] text-slate-400">เข้าร่วมด้วยรหัส {joinCode}</p>
                      </div>
                    </div>
                    <span className="rounded-full px-3 py-1 text-[12px] font-semibold bg-slate-100 text-slate-600">
                      สมาชิก
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              TEAM_MEMBERS.map((member) => (
                <div key={member.email} className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-bold text-white ${member.color}`}
                    >
                      {member.initials}
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-slate-800">{member.name}</p>
                      <p className="text-[12px] text-slate-400">{member.email}</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                      member.role === "leader"
                        ? "bg-rose-50 text-rose-500"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {member.role === "leader" ? "หัวหน้าโครงการ" : "สมาชิก"}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "ภาพรวม" && (
        <section className="gt-card p-7">
          <h2 className="mb-2 text-[18px] font-bold">ภาพรวมโครงการ</h2>
          <p className="text-[14px] text-slate-400">
            {dbGroup ? `รูปแบบการทำงาน: ${dbGroup.work_mode === 'leader_all' ? 'หัวหน้าคุมทั้งหมด' : dbGroup.work_mode === 'member_choose' ? 'สมาชิกเลือกเอง' : 'แบบผสมผสาน'}` : `ความคืบหน้าปัจจุบัน ${mockProject.progress}%`}
          </p>
        </section>
      )}

      {tab === "สรุปผล" && (
        <section className="gt-card p-7">
          <h2 className="mb-2 text-[18px] font-bold">สรุปผล</h2>
          <p className="text-[14px] text-slate-400">ยังไม่มีรายงานสรุปผลในรอบนี้</p>
        </section>
      )}
    </div>
  );
}
