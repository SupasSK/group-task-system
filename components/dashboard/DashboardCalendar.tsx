'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Clock, CheckCircle2, AlertCircle, Plus,
} from 'lucide-react';

export interface EventItem {
  id: string;
  title: string;
  project: string;
  dateStr: string; // YYYY-MM-DD
  time?: string;
  type: 'deadline' | 'review' | 'meeting' | 'milestone';
  color: string; // Tailwind bg class
  completed?: boolean;
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function formatYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ได้ Sunday ของสัปดาห์ที่ date อยู่
function getWeekStart(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// events = กำหนดส่งงานจริงจากกลุ่มของผู้ใช้ (หน้าแดชบอร์ดเป็นผู้ส่งมา)
export default function DashboardCalendar({ events }: { events: EventItem[] }) {
  const [today] = useState(() => new Date());
  const [weekStart, setWeekStart] = useState<Date>(getWeekStart(today));
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  const todayStr = formatYMD(today);
  const selectedStr = formatYMD(selectedDate);

  // 7 วันของสัปดาห์นี้
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const weekLabel = () => {
    const s = weekDays[0];
    const e = weekDays[6];
    if (s.getMonth() === e.getMonth()) {
      return `${s.getDate()}–${e.getDate()} ${THAI_MONTHS[s.getMonth()]} ${s.getFullYear() + 543}`;
    }
    return `${s.getDate()} ${THAI_MONTHS[s.getMonth()]} – ${e.getDate()} ${THAI_MONTHS[e.getMonth()]} ${e.getFullYear() + 543}`;
  };

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };
  const goToday = () => {
    setWeekStart(getWeekStart(today));
    setSelectedDate(today);
  };

  const selectedDayEvents = events.filter((e) => e.dateStr === selectedStr);

  const typeIcon = (type: EventItem['type']) => {
    if (type === 'deadline') return <AlertCircle size={12} />;
    if (type === 'review') return <Clock size={12} />;
    if (type === 'milestone') return <CheckCircle2 size={12} />;
    return <CalendarIcon size={12} />;
  };

  return (
    <section className="gt-card overflow-hidden rounded-3xl border border-slate-100 shadow-sm bg-white">
      {/* ===== Top Bar ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-100">
            <CalendarIcon size={20} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold text-slate-800 leading-tight">ปฏิทินงาน</h2>
            <p className="text-[12px] text-slate-400">{weekLabel()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* ปุ่มสร้างงานใหม่ */}
          <Link
            href="/dashboard/leader"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[13px] font-semibold shadow-md shadow-indigo-100 hover:opacity-90 hover:scale-[1.02] transition-all"
          >
            <Plus size={15} />
            สร้างงาน
          </Link>

          {/* นำทางสัปดาห์ */}
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/60">
            <button
              onClick={goToday}
              className="px-2.5 py-1 text-[12px] font-semibold text-indigo-600 hover:bg-white rounded-lg transition-colors"
            >
              วันนี้
            </button>
            <div className="h-3.5 w-px bg-slate-200" />
            <button onClick={prevWeek} aria-label="สัปดาห์ก่อน" className="p-1 text-slate-500 hover:text-slate-800 hover:bg-white rounded-lg transition-colors">
              <ChevronLeft size={16} />
            </button>
            <button onClick={nextWeek} aria-label="สัปดาห์ถัดไป" className="p-1 text-slate-500 hover:text-slate-800 hover:bg-white rounded-lg transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ===== Weekly Grid ===== */}
      <div className="grid grid-cols-7 divide-x divide-slate-100">
        {weekDays.map((day, i) => {
          const dStr = formatYMD(day);
          const isToday = dStr === todayStr;
          const isSelected = dStr === selectedStr;
          const dayEvents = events.filter((e) => e.dateStr === dStr);
          const isWeekend = i === 0 || i === 6;

          return (
            <button
              key={dStr}
              type="button"
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center gap-1 py-3 px-1 min-h-[100px] sm:min-h-[120px] transition-colors text-left w-full ${
                isSelected
                  ? 'bg-indigo-50/80'
                  : isWeekend
                  ? 'bg-slate-50/50 hover:bg-slate-100/60'
                  : 'bg-white hover:bg-slate-50/70'
              }`}
            >
              {/* หัววัน */}
              <div className="flex flex-col items-center gap-0.5 w-full">
                <span className={`text-[11px] font-semibold ${
                  isWeekend
                    ? i === 0 ? 'text-rose-400' : 'text-indigo-400'
                    : 'text-slate-400'
                }`}>
                  {THAI_WEEKDAYS_SHORT[i]}
                </span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-bold transition-all ${
                  isToday
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm'
                    : isSelected
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-slate-700'
                }`}>
                  {day.getDate()}
                </span>
              </div>

              {/* Event blocks */}
              <div className="flex flex-col gap-1 w-full px-1 mt-1">
                {dayEvents.slice(0, 2).map((ev) => (
                  <div
                    key={ev.id}
                    className={`${ev.color} text-white rounded-md px-1.5 py-0.5 text-[10px] font-semibold flex items-center gap-1 leading-tight truncate ${ev.completed ? 'opacity-60' : ''}`}
                  >
                    {typeIcon(ev.type)}
                    <span className="truncate">{ev.title}</span>
                  </div>
                ))}
                {dayEvents.length > 2 && (
                  <span className="text-[10px] text-slate-400 font-medium px-1">
                    +{dayEvents.length - 2} อื่นๆ
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ===== Selected Day Events Panel ===== */}
      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/40">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
            <span>📌</span>
            {selectedDate.getDate()} {THAI_MONTHS[selectedDate.getMonth()]} {selectedDate.getFullYear() + 543}
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-semibold">
            {selectedDayEvents.length} รายการ
          </span>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="py-5 text-center text-slate-400 text-[13px] bg-white rounded-2xl border border-dashed border-slate-200">
            ไม่มีกำหนดการในวันนี้
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDayEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-white border border-slate-100 hover:border-indigo-100 transition-all shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-white ${e.color} shadow-sm text-sm flex-shrink-0`}>
                    {typeIcon(e.type)}
                  </div>
                  <div>
                    <p className={`text-[13px] font-semibold leading-tight ${e.completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {e.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {e.project}
                      </span>
                      {e.time && (
                        <span className="text-[11px] text-slate-400">🕒 {e.time} น.</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${
                  e.completed
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {e.completed ? 'เสร็จสิ้น' : 'รอดำเนินการ'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
