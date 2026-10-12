"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import ProgressBar from "@/components/ui/ProgressBar";
import AvatarStack from "@/components/ui/AvatarStack";
import { PROJECTS } from "@/lib/mock-data";

export default function ProjectsPage() {
  return (
    <div>
      <div className="mb-7 flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-slate-800">โครงการของฉัน</h1>
        <Link href="/dashboard/projects/new" className="gt-btn rounded-xl px-4 py-2.5 text-[14px]">
          <Plus size={16} />
          สร้างโครงการใหม่
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {PROJECTS.map((project) => {
          const extra = Math.max(0, project.members - project.shownAvatars);
          return (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="gt-card block p-6 transition hover:-translate-y-0.5"
            >
              <h2 className="text-[17px] font-bold text-slate-800">{project.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
                {project.description}
              </p>
              <p className="mt-5 mb-2 text-[12px] text-slate-400">ความคืบหน้า</p>
              <ProgressBar value={project.progress} />
              <p className="mt-5 mb-2 text-[12px] text-slate-400">สมาชิกในกลุ่ม</p>
              <AvatarStack shown={project.shownAvatars} extra={extra} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
