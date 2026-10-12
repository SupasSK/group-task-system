"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { TEAM_MEMBERS } from "@/lib/mock-data";

const priorities = [
  { value: "สูง", color: "text-rose-500", border: "border-rose-300 bg-rose-50" },
  { value: "ปานกลาง", color: "text-orange-500", border: "border-orange-300 bg-orange-50" },
  { value: "ต่ำ", color: "text-emerald-500", border: "border-emerald-300 bg-emerald-50" },
];

export default function NewTaskPage() {
  const router = useRouter();
  const [title, setTitle] = useState("พัฒนาหน้าโปรไฟล์ผู้ใช้งานและประวัติการสั่งซื้อ");
  const [details, setDetails] = useState(
    "ออกแบบและเขียนโค้ดหน้าโปรไฟล์เพื่อให้ผู้ใช้งานสามารถแก้ไขชื่อ ที่อยู่จัดส่ง เบอร์โทรศัพท์ และเข้าไปดูประวัติคำสั่งซื้อย้อนหลังทั้งหมดได้..."
  );
  const [assignee, setAssignee] = useState(TEAM_MEMBERS[1].email);
  const [priority, setPriority] = useState("ปานกลาง");
  const [dueDate, setDueDate] = useState("2526-10-30");

  const selected = TEAM_MEMBERS.find((m) => m.email === assignee) || TEAM_MEMBERS[1];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-slate-800">สร้างงานใหม่</h1>
        <p className="mt-1 text-[14px] text-slate-400">
          แอปพลิเคชันเดลิเวอรี่อาหาร • กำหนดเป้าหมายและผู้รับผิดชอบงานให้ชัดเจน
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/dashboard/tasks");
        }}
        className="gt-card mx-auto max-w-3xl space-y-6 p-8"
      >
        <div>
          <label className="mb-2 block text-[14px] font-semibold">
            ชื่องาน <span className="text-rose-500">*</span>
          </label>
          <input className="gt-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div>
          <label className="mb-2 block text-[14px] font-semibold">รายละเอียดงาน</label>
          <textarea
            className="gt-input resize-none"
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-[14px] font-semibold">มอบหมายให้</label>
          <div className="relative">
            <select
              className="gt-input appearance-none pr-10"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {TEAM_MEMBERS.map((member) => (
                <option key={member.email} value={member.email}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-500">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white ${selected.color}`}>
              {selected.initials}
            </div>
            {selected.name} ({selected.email})
          </div>
        </div>

        <div>
          <label className="mb-2 block text-[14px] font-semibold">ระดับความสำคัญ</label>
          <div className="grid grid-cols-3 gap-3">
            {priorities.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPriority(item.value)}
                className={`rounded-xl border px-4 py-3 text-[14px] font-semibold ${item.color} ${
                  priority === item.value ? item.border : "border-transparent bg-slate-50"
                }`}
              >
                {item.value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-[14px] font-semibold">วันกำหนดส่ง</label>
          <div className="relative">
            <input
              type="date"
              className="gt-input pr-10"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <Calendar size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <button type="submit" className="gt-btn w-full py-3.5 text-[15px]">
          สร้างงาน
        </button>
      </form>
    </div>
  );
}
