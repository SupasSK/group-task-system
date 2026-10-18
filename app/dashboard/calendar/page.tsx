'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase';
import { toneOf, TONE } from '@/lib/statusTone';
import DashboardCalendar, { type EventItem } from '@/components/dashboard/DashboardCalendar';

type GroupRow = { groups: { group_id: string; group_name: string; archived_at: string | null } | null };

// ปฏิทินกำหนดส่งของงานทุกงานในทุกกลุ่มของผู้ใช้ (ดูอย่างเดียว งานสร้างในหน้ากลุ่ม)
export default function CalendarPage() {
  const supabase = createClient();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: memberGroups } = await supabase
          .from('group_members')
          .select(`
            groups (
              group_id,
              group_name,
              archived_at
            )
          `)
          .eq('user_id', user.id);

        const groupName: Record<string, string> = {};
        for (const item of (memberGroups || []) as unknown as GroupRow[]) {
          if (item.groups && !item.groups.archived_at) groupName[item.groups.group_id] = item.groups.group_name;
        }
        const groupIds = Object.keys(groupName);
        if (groupIds.length === 0) return;

        const { data: taskRows } = await supabase
          .from('tasks')
          .select('*')
          .in('group_id', groupIds);

        const pad = (n: number) => String(n).padStart(2, '0');
        setEvents(
          (taskRows || [])
            .filter((t) => t.deadline)
            .map((t) => {
              const d = new Date(t.deadline);
              return {
                id: t.task_id,
                title: t.title,
                project: groupName[t.group_id] || '',
                dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
                tone: toneOf(t),
                completed: t.status === 'completed',
                href: `/dashboard/groups/${t.group_id}?tab=tasks&task=${t.task_id}`,
              };
            })
        );
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [supabase]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[24px] font-bold text-slate-900">ปฏิทิน</h1>
        <div className="flex flex-wrap gap-3 text-[12px] text-slate-700">
          {(['doing', 'waiting', 'done', 'overdue', 'neutral'] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${TONE[k].dot}`} />
              {TONE[k].label}
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-500">
          กำลังโหลดข้อมูล...
        </div>
      ) : (
        <DashboardCalendar events={events} />
      )}
    </div>
  );
}
