'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { TONE, type Tone } from '@/lib/statusTone';

export interface EventItem {
  id: string;
  title: string;
  project: string;
  dateStr: string; // YYYY-MM-DD
  time?: string;
  tone: Tone; // สีตามสถานะ (lib/statusTone.ts)
  completed?: boolean;
  href?: string; // หน้ากลุ่มของงาน (คลิกรายการใต้ปฏิทินแล้วไปที่นี่)
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// แถบงานในช่องวัน: พื้นอ่อน + เส้นซ้ายสีเข้มตามสถานะ
const BAR: Record<Tone, string> = {
  doing: 'bg-sky-50 border-l-sky-500 text-sky-900',
  waiting: 'bg-amber-50 border-l-amber-500 text-amber-900',
  done: 'bg-emerald-50 border-l-emerald-500 text-emerald-900',
  overdue: 'bg-rose-50 border-l-rose-500 text-rose-900',
  neutral: 'bg-slate-50 border-l-slate-400 text-slate-800',
};

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

// events = กำหนดส่งงานจริงจากกลุ่มของผู้ใช้ (หน้าปฏิทินเป็นผู้ส่งมา)
export default function DashboardCalendar({ events }: { events: EventItem[] }) {
  const [today] = useState(() => new Date());
  const [weekStart, setWeekStart] = useState<Date>(getWeekStart(today));
  const [monthStart, setMonthStart] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
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

  // มุมมองรายเดือน (จอคอม): เริ่มที่วันอาทิตย์ก่อนวันที่ 1 จนครบสัปดาห์ที่มีวันสุดท้ายของเดือน
  const monthGridStart = getWeekStart(monthStart);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const monthWeeks = Math.ceil((monthStart.getDay() + daysInMonth) / 7);
  const monthDays = Array.from({ length: monthWeeks * 7 }, (_, i) => {
    const d = new Date(monthGridStart);
    d.setDate(monthGridStart.getDate() + i);
    return d;
  });
  const monthLabel = `${THAI_MONTHS[monthStart.getMonth()]} ${monthStart.getFullYear() + 543}`;

  const prevMonth = () => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1));
  const nextMonth = () => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1));

  const selectDay = (day: Date) => {
    setSelectedDate(day);
    setWeekStart(getWeekStart(day));
    setMonthStart(new Date(day.getFullYear(), day.getMonth(), 1));
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
    setMonthStart(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const selectedDayEvents = events.filter((e) => e.dateStr === selectedStr);
  const navBtn = 'rounded-lg p-1.5 text-slate-700 hover:bg-slate-100';

  const bar = (ev: EventItem) => (
    <div
      key={ev.id}
      title={`${ev.project}: ${ev.title}`}
      className={`rounded-md border-l-[3px] px-1.5 py-1 text-[12px] leading-snug ${BAR[ev.tone]} ${ev.completed ? 'opacity-70' : ''}`}
    >
      <span className="block truncate text-[11px] font-semibold opacity-80">{ev.project}</span>
      <span className="line-clamp-2">{ev.title}</span>
    </div>
  );

  // ช่องวัน ใช้ทั้งมุมมองสัปดาห์ (มือถือ) และเดือน (จอคอม) dim = วันนอกเดือนที่แสดง
  const dayCell = (day: Date, dim: boolean, tall: string) => {
    const dStr = formatYMD(day);
    const dayEvents = events.filter((e) => e.dateStr === dStr);
    return (
      <button
        key={dStr}
        type="button"
        onClick={() => selectDay(day)}
        className={`${tall} w-full border-b border-r border-slate-100 p-1.5 text-left align-top ${
          dStr === selectedStr ? 'bg-violet-50' : dim ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
        }`}
      >
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
            dStr === todayStr ? 'bg-violet-600 text-white' : dim ? 'text-slate-400' : 'text-slate-800'
          }`}
        >
          {day.getDate()}
        </span>
        <div className={`mt-1 space-y-1 ${dim ? 'opacity-60' : ''}`}>
          {dayEvents.slice(0, 2).map(bar)}
          {dayEvents.length > 2 && (
            <span className="px-1 text-[12px] font-medium text-slate-600">+{dayEvents.length - 2} อื่น ๆ</span>
          )}
        </div>
      </button>
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      {/* ===== Top Bar ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-[16px] font-bold text-slate-900">
          <span className="md:hidden">{weekLabel()}</span>
          <span className="hidden md:inline">{monthLabel}</span>
        </h2>

        {/* นำทางสัปดาห์ (มือถือ) / เดือน (จอคอม) */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5">
          <button onClick={goToday} className="rounded-md px-2.5 py-1 text-[13px] font-semibold text-violet-700 hover:bg-slate-100">
            วันนี้
          </button>
          <button onClick={prevWeek} aria-label="สัปดาห์ก่อน" className={`${navBtn} md:hidden`}>
            <ChevronLeft size={18} />
          </button>
          <button onClick={nextWeek} aria-label="สัปดาห์ถัดไป" className={`${navBtn} md:hidden`}>
            <ChevronRight size={18} />
          </button>
          <button onClick={prevMonth} aria-label="เดือนก่อน" className={`${navBtn} hidden md:block`}>
            <ChevronLeft size={18} />
          </button>
          <button onClick={nextMonth} aria-label="เดือนถัดไป" className={`${navBtn} hidden md:block`}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100">
        {THAI_WEEKDAYS_SHORT.map((w) => (
          <span key={w} className="py-2 text-center text-[12px] font-semibold text-slate-600">
            {w}
          </span>
        ))}
      </div>

      {/* ===== Weekly Grid (มือถือ) ===== */}
      <div className="grid grid-cols-7 md:hidden">
        {weekDays.map((day) => dayCell(day, false, 'min-h-[120px]'))}
      </div>

      {/* ===== Monthly Grid (จอคอม) ===== */}
      <div className="hidden grid-cols-7 md:grid">
        {monthDays.map((day) => dayCell(day, day.getMonth() !== monthStart.getMonth(), 'min-h-[104px]'))}
      </div>

      {/* ===== Selected Day Events Panel ===== */}
      <div className="rounded-b-2xl bg-slate-50 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[14px] font-semibold text-slate-900">
            {selectedDate.getDate()} {THAI_MONTHS[selectedDate.getMonth()]} {selectedDate.getFullYear() + 543}
          </p>
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200">
            {selectedDayEvents.length} รายการ
          </span>
        </div>

        {selectedDayEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white py-5 text-center text-[13px] text-slate-600">
            ไม่มีกำหนดส่งในวันนี้
          </p>
        ) : (
          <div className="space-y-2">
            {selectedDayEvents.map((e) => (
              <Link
                key={e.id}
                href={e.href ?? '#'}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-violet-300"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`h-9 w-1.5 shrink-0 rounded-full ${TONE[e.tone].dot}`} />
                  <div className="min-w-0">
                    <p className={`truncate text-[14px] font-semibold ${e.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                      {e.title}
                    </p>
                    <p className="flex items-center gap-1 text-[12px] text-slate-600">
                      {e.project}
                      {e.time && (
                        <>
                          {' · '}
                          <Clock size={11} />
                          {e.time} น.
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TONE[e.tone].badge}`}>
                  {TONE[e.tone].label}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
