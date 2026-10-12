"use client";

import Link from "next/link";
import { Calendar, Plus } from "lucide-react";
import { KANBAN, type KanbanTask } from "@/lib/mock-data";

const priorityClass: Record<KanbanTask["priority"], string> = {
  ต่ำ: "bg-emerald-50 text-emerald-600",
  ปานกลาง: "bg-amber-50 text-amber-500",
  สูง: "bg-rose-50 text-rose-500",
  เสร็จแล้ว: "bg-emerald-50 text-emerald-600",
};

function TaskCard({ task }: { task: KanbanTask }) {
  return (
    <article
      className={`rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] ${
        task.highlight ? "ring-1 ring-blue-400" : ""
      }`}
    >
      <h3 className="text-[14px] font-bold text-slate-800">{task.title}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{task.description}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={task.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
          <span className="text-[12px] text-slate-500">{task.assignee}</span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${priorityClass[task.priority]}`}>
          {task.priority}
        </span>
      </div>
      <div className={`mt-3 flex items-center gap-1.5 text-[12px] ${task.dateTone === "pink" ? "text-rose-400" : "text-slate-400"}`}>
        <Calendar size={13} />
        <span>{task.date}</span>
      </div>
    </article>
  );
}

export default function TasksPage() {
  const columns = [
    { key: "todo" as const, title: "รอรับ", badge: "bg-slate-200 text-slate-600", tasks: KANBAN.todo },
    { key: "doing" as const, title: "กำลังทำ", badge: "bg-blue-100 text-blue-600", tasks: KANBAN.doing },
    { key: "done" as const, title: "เสร็จแล้ว", badge: "bg-emerald-100 text-emerald-600", tasks: KANBAN.done },
  ];

  return (
    <div>
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800">งานทั้งหมดในโครงการ</h1>
          <p className="mt-1 text-[14px] text-slate-400">
            แอปพลิเคชันเดลิเวอรี่อาหาร • ติดตามสถานะและการส่งมอบงานของทีม
          </p>
        </div>
        <Link href="/dashboard/tasks/new" className="gt-btn rounded-xl px-4 py-2.5 text-[14px]">
          <Plus size={16} />
          สร้างงานใหม่
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {columns.map((column) => (
          <section key={column.key}>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-[15px] font-bold text-slate-700">{column.title}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${column.badge}`}>
                {column.tasks.length}
              </span>
            </div>
            <div className="space-y-4">
              {column.tasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
