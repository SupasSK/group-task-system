'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase';
import { loadUnreadCounts } from '@/lib/unreadCounts';
import { projectProgress } from '@/lib/projectProgress';
import { Plus, Crown, FolderOpen } from 'lucide-react';

interface MyGroup {
  group_id: string;
  group_name: string;
  work_mode: string;
  role: string;
}

const WORK_MODE_LABEL: Record<string, string> = {
  leader_all: 'หัวหน้ามอบหมาย',
  member_choose: 'สมาชิกเลือกเอง',
  mixed: 'แบบผสม',
};

type Filter = 'all' | 'leader' | 'member';

type MemberRow = {
  role: string;
  groups: { group_id: string; group_name: string; work_mode: string; archived_at: string | null } | null;
};

export default function MyGroupsPage() {
  const supabase = createClient();
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [taskStatus, setTaskStatus] = useState<{ group_id: string; status: string }[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // โหลดไม่สำเร็จ (เช่น เน็ตหลุด) ต้องไม่แสดงว่า "ยังไม่มีกลุ่ม"
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: rows, error } = await supabase
          .from('group_members')
          .select(`
            role,
            groups (
              group_id,
              group_name,
              work_mode,
              archived_at
            )
          `)
          .eq('user_id', user.id);
        if (error || !rows) {
          setLoadFailed(true);
          return;
        }

        const mine: MyGroup[] = (rows as unknown as MemberRow[])
          .filter((item) => item.groups && !item.groups.archived_at)
          .map((item) => ({
            group_id: item.groups!.group_id,
            group_name: item.groups!.group_name,
            work_mode: item.groups!.work_mode,
            role: item.role,
          }));
        setGroups(mine);

        const ids = mine.map((g) => g.group_id);
        if (ids.length > 0) {
          const [{ data: members }, { data: tasks }, counts] = await Promise.all([
            supabase.from('group_members').select('group_id').in('group_id', ids),
            supabase.from('tasks').select('group_id, status').in('group_id', ids),
            loadUnreadCounts(supabase, user.id),
          ]);
          const n: Record<string, number> = {};
          for (const m of members || []) n[m.group_id] = (n[m.group_id] || 0) + 1;
          setMemberCounts(n);
          setTaskStatus(tasks || []);
          setUnread(counts);
        }
      } catch (err) {
        console.error(err);
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [supabase]);

  const leaderGroups = groups.filter((g) => g.role === 'leader');
  const memberGroups = groups.filter((g) => g.role !== 'leader');
  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'ทั้งหมด', n: groups.length },
    { id: 'leader', label: 'ที่ฉันเป็นหัวหน้า', n: leaderGroups.length },
    { id: 'member', label: 'ที่ฉันเป็นสมาชิก', n: memberGroups.length },
  ];
  const sections = [
    { title: 'กลุ่มที่ฉันเป็นหัวหน้า', items: leaderGroups, leader: true, show: filter !== 'member' },
    { title: 'กลุ่มที่ฉันเป็นสมาชิก', items: memberGroups, leader: false, show: filter !== 'leader' },
  ].filter((s) => s.show);

  if (loading) {
    return (
      <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-500">
        กำลังโหลดข้อมูล...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[24px] font-bold text-slate-900">กลุ่มของฉัน</h1>
        <Link href="/dashboard/projects/new" className="gt-btn inline-flex items-center gap-1.5 px-4 py-2 text-[14px]">
          <Plus size={16} /> สร้าง / เข้ากลุ่ม
        </Link>
      </div>

      {loadFailed && (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-[13px] text-rose-800">
          โหลดรายชื่อกลุ่มไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่
        </p>
      )}

      {!loadFailed && groups.length === 0 && (
        <section className="gt-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <FolderOpen size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-900">ยังไม่มีกลุ่ม</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-600">
            สร้างกลุ่มใหม่ถ้าคุณเป็นหัวหน้า หรือกรอกรหัส 6 ตัวที่ได้จากหัวหน้าเพื่อเข้าร่วมกลุ่ม
          </p>
        </section>
      )}

      {groups.length > 0 && (
        <>
          <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`rounded-lg px-3 py-1.5 text-[13px] ${
                  filter === t.id
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'font-medium text-slate-700 hover:text-slate-900'
                }`}
              >
                {t.label} <span className="text-slate-500">{t.n}</span>
              </button>
            ))}
          </div>

          {sections.map((sec) => (
            <section key={sec.title}>
              {filter === 'all' && (
                <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-bold text-slate-800">
                  {sec.leader && <Crown size={15} className="text-violet-700" />}
                  {sec.title} ({sec.items.length})
                </h2>
              )}
              {sec.items.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-4 text-[13px] text-slate-600">
                  ยังไม่มีกลุ่ม
                </p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {sec.items.map((g) => {
                    const tasks = taskStatus.filter((t) => t.group_id === g.group_id);
                    const done = tasks.filter((t) => t.status === 'completed').length;
                    const n = unread[g.group_id] || 0;
                    return (
                      <Link
                        key={g.group_id}
                        href={`/dashboard/groups/${g.group_id}`}
                        className={`flex flex-wrap items-center gap-3 border-b border-l-4 border-b-slate-100 px-5 py-4 last:border-b-0 hover:bg-slate-50 ${
                          sec.leader ? 'border-l-violet-500' : 'border-l-transparent'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-semibold text-slate-900">{g.group_name}</p>
                            {sec.leader ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[12px] font-semibold text-violet-800">
                                <Crown size={12} /> หัวหน้า
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-700">
                                สมาชิก
                              </span>
                            )}
                            {n > 0 && (
                              <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[12px] font-semibold text-white">
                                {n} ใหม่
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[12px] text-slate-600">
                            {WORK_MODE_LABEL[g.work_mode] ?? g.work_mode} · สมาชิก {memberCounts[g.group_id] ?? 0} คน
                          </p>
                        </div>
                        {/* ความคืบหน้า = งานเสร็จ / งานทั้งหมด (lib/projectProgress.ts) */}
                        <div className="flex w-40 items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-violet-600"
                              style={{ width: `${projectProgress(tasks)}%` }}
                            />
                          </div>
                          <span className="text-[12px] font-medium text-slate-600">
                            {done}/{tasks.length}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
