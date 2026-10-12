'use client';

import { useState, useEffect } from 'react';

const LAST_LOGIN = '2026-09-28T08:00:00';

const allActivities = [
  { icon: '📝', title: 'สมชาย สร้างงาน "พัฒนาหน้าโปรไฟล์ผู้ใช้งาน"', time: '2026-09-28T09:12:00', group: 'GroupTask Dev' },
  { icon: '🔄', title: 'นที อัปเดตสถานะงาน "ออกแบบ UI" เป็นกำลังทำ', time: '2026-09-27T16:40:00', group: 'แอปเดลิเวอรี่' },
  { icon: '👋', title: 'วรัญญา เข้าร่วมโครงการแอปพลิเคชันเดลิเวอรี่อาหาร', time: '2026-09-18T12:00:00', group: 'แอปเดลิเวอรี่' },
];

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + ' นาทีที่แล้ว';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' ชั่วโมงที่แล้ว';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + ' วันที่แล้ว';
  return new Date(iso).toLocaleDateString('th-TH');
}

export default function ActivityPage() {
  const [newItems, setNewItems] = useState<typeof allActivities>([]);
  const [oldItems, setOldItems] = useState<typeof allActivities>([]);

  useEffect(() => {
    setNewItems(allActivities.filter((a) => a.time > LAST_LOGIN));
    setOldItems(allActivities.filter((a) => a.time <= LAST_LOGIN));
  }, []);

  return (
    <div>
      <div className="mb-7 flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-slate-800">ประวัติกิจกรรม</h1>
        <span className="rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 px-3 py-1 text-[12px] font-semibold text-white shadow">
          ล็อกอินล่าสุด: {new Date(LAST_LOGIN).toLocaleString('th-TH')}
        </span>
      </div>

      {newItems.length > 0 ? (
        <section className="mb-6">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-indigo-500">
            ✨ ใหม่ตั้งแต่ครั้งล่าสุด ({newItems.length})
          </p>
          <div className="gt-card divide-y divide-slate-100">
            {newItems.map((item) => (
              <div key={item.title} className="flex items-start gap-4 px-6 py-4">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-lg">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-800">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{item.group}</span>
                    <span className="text-[12px] text-slate-400">{relativeTime(item.time)}</span>
                  </div>
                </div>
                <span className="mt-1 flex-shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                  ใหม่
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="gt-card mb-6 flex items-center gap-3 px-6 py-5 text-slate-500">
          <span className="text-2xl">🎉</span>
          <p className="text-[14px]">ไม่มีเหตุการณ์ใหม่หลังจากการล็อกอินครั้งล่าสุด</p>
        </section>
      )}

      {oldItems.length > 0 && (
        <section>
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-slate-400">
            ก่อนหน้า
          </p>
          <div className="gt-card divide-y divide-slate-100">
            {oldItems.map((item) => (
              <div key={item.title} className="flex items-start gap-4 px-6 py-4 opacity-60">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-700">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{item.group}</span>
                    <span className="text-[12px] text-slate-400">{relativeTime(item.time)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
