'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase';
import { loadUnreadCounts } from '@/lib/unreadCounts';
import { projectProgress } from '@/lib/projectProgress';
import DashboardCalendar, { type EventItem } from '@/components/dashboard/DashboardCalendar';
import { ACTION_STYLE } from '@/components/dashboard/CatchUpDigest';
import {
  Plus, UserPlus, Sparkles, LayoutGrid, FolderOpen, ClipboardList, Zap,
  CheckCircle2, AlertTriangle, Crown, User, Clock, ArrowRight, RefreshCw,
} from 'lucide-react';

// ข้อความสั้นของกิจกรรมแต่ละประเภท สำหรับรายการกิจกรรมล่าสุด
const ACTION_LABEL: Record<string, string> = {
  group_created: 'สร้างกลุ่ม',
  member_added: 'มีสมาชิกใหม่',
  member_removed: 'นำสมาชิกออก',
  member_left: 'สมาชิกออกจากกลุ่ม',
  leader_transferred: 'เปลี่ยนหัวหน้ากลุ่ม',
  task_created: 'สร้างงาน',
  task_updated: 'แก้ไขงาน',
  task_deleted: 'ลบงาน',
  task_status_changed: 'เปลี่ยนสถานะงาน',
  task_assigned: 'มอบหมายงาน',
  task_accepted: 'รับงาน',
  task_declined: 'ปฏิเสธงาน',
  task_claimed: 'เลือกรับงาน',
  task_joined: 'เข้าร่วมทำงาน',
  task_feedback_added: 'ส่งฟีดแบคเพื่อนร่วมงาน',
  comment_added: 'เขียนบันทึก',
  decision_added: 'บันทึกการตัดสินใจ',
  eval_round_opened: 'เปิดรอบประเมินเพื่อน',
  eval_round_closed: 'ปิดรอบประเมินเพื่อน',
};

interface RecentLog {
  log_id: number;
  group_id: string;
  action_type: string;
  payload: { title?: string } | null;
  created_at: string;
}

interface SupabaseGroup {
  group_id: string;
  group_name: string;
  description: string;
  work_mode: string;
  join_code: string;
  role?: string;
}

export default function DashboardPage() {
  const supabase = createClient();
  const [userGroups, setUserGroups] = useState<SupabaseGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  // จำนวนกิจกรรมใหม่ของแต่ละกลุ่ม ตั้งแต่เข้าดูครั้งล่าสุด
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  // สถิติงาน กำหนดส่ง และกิจกรรมล่าสุด จากทุกกลุ่มของผู้ใช้
  const [taskStats, setTaskStats] = useState({ total: 0, doing: 0, done: 0, overdue: 0 });
  const [events, setEvents] = useState<EventItem[]>([]);
  // ความคืบหน้าของแต่ละกลุ่ม (0-100)
  const [groupProgress, setGroupProgress] = useState<Record<string, number>>({});
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  // โหลดข้อมูลไม่สำเร็จ (เช่น เน็ตหลุด) ต้องไม่แสดงว่า "ยังไม่มีกลุ่ม"
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    loadUserGroups();
  }, []);

  const loadUserGroups = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingGroups(false);
        return;
      }

      // ดึงกลุ่มที่ผู้ใช้สร้าง หรือเป็นสมาชิก
      const { data: memberGroups, error } = await supabase
        .from('group_members')
        .select(`
          role,
          groups (
            group_id,
            group_name,
            description,
            work_mode,
            join_code,
            archived_at
          )
        `)
        .eq('user_id', user.id);

      if (error) setLoadFailed(true);
      if (!error && memberGroups) {
        const groups: SupabaseGroup[] = memberGroups
          .filter((item: any) => item.groups && !item.groups.archived_at)
          .map((item: any) => ({
            group_id: item.groups.group_id,
            group_name: item.groups.group_name,
            description: item.groups.description || '',
            work_mode: item.groups.work_mode,
            join_code: item.groups.join_code,
            role: item.role,
          }));
        setUserGroups(groups);
        setUnreadCounts(await loadUnreadCounts(supabase, user.id));

        const groupIds = groups.map((g) => g.group_id);
        if (groupIds.length > 0) {
          const groupName: Record<string, string> = {};
          groups.forEach((g) => { groupName[g.group_id] = g.group_name; });

          const { data: taskRows } = await supabase
            .from('tasks')
            .select('*')
            .in('group_id', groupIds);
          const tasks = taskRows || [];

          const progressMap: Record<string, number> = {};
          for (const id of groupIds) {
            progressMap[id] = projectProgress(tasks.filter((t) => t.group_id === id));
          }
          setGroupProgress(progressMap);
          const now = new Date();
          const isOverdue = (t: { deadline: string | null; status: string }) =>
            t.deadline && new Date(t.deadline) < now && t.status !== 'completed' && t.status !== 'rejected';

          setTaskStats({
            total: tasks.length,
            doing: tasks.filter((t) => t.status === 'accepted' || t.status === 'in_progress').length,
            done: tasks.filter((t) => t.status === 'completed').length,
            overdue: tasks.filter(isOverdue).length,
          });

          setEvents(
            tasks
              .filter((t) => t.deadline)
              .map((t) => {
                const d = new Date(t.deadline);
                const pad = (n: number) => String(n).padStart(2, '0');
                return {
                  id: t.task_id,
                  title: t.title,
                  project: groupName[t.group_id] || '',
                  dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                  time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
                  type: 'deadline' as const,
                  color: t.status === 'completed' ? 'bg-emerald-500' : isOverdue(t) ? 'bg-rose-500' : 'bg-indigo-500',
                  completed: t.status === 'completed',
                  overdue: isOverdue(t),
                  href: `/dashboard/groups/${t.group_id}`,
                };
              })
          );

          const { data: logRows } = await supabase
            .from('activity_logs')
            .select('log_id, group_id, action_type, payload, created_at')
            .in('group_id', groupIds)
            .order('created_at', { ascending: false })
            .limit(4);
          setRecentLogs(logRows || []);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGroups(false);
    }
  };

  const stats = [
    { label: 'กลุ่มทั้งหมด', value: userGroups.length, color: 'from-indigo-500 to-purple-500', icon: FolderOpen, iconClass: 'bg-indigo-100 text-indigo-600' },
    { label: 'งานทั้งหมด', value: taskStats.total, color: 'from-purple-500 to-pink-500', icon: ClipboardList, iconClass: 'bg-purple-100 text-purple-600' },
    { label: 'กำลังดำเนินการ', value: taskStats.doing, color: 'from-blue-500 to-cyan-400', icon: Zap, iconClass: 'bg-blue-100 text-blue-600' },
    { label: 'เสร็จสิ้น', value: taskStats.done, color: 'from-emerald-500 to-teal-400', icon: CheckCircle2, iconClass: 'bg-emerald-100 text-emerald-600' },
    { label: 'เลยกำหนด', value: taskStats.overdue, color: 'from-rose-500 to-pink-400', icon: AlertTriangle, iconClass: 'bg-rose-100 text-rose-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[28px] font-bold text-slate-800">
            <LayoutGrid size={26} className="text-indigo-500" />
            ภาพรวมทั้งหมด
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            ยินดีต้อนรับสู่ระบบบริหารจัดการงานกลุ่มและติดตามสถานะงานแบบเรียลไทม์
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/projects/join"
            className="flex items-center gap-2 rounded-2xl border-2 border-indigo-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-all shadow-sm"
          >
            <UserPlus size={16} />
            เข้าร่วมกลุ่ม
          </Link>
          <Link
            href="/dashboard/projects/new"
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 hover:scale-[1.02] transition-all"
          >
            <Plus size={18} />
            สร้างกลุ่มใหม่
          </Link>
        </div>
      </div>

      {/* ===== ปฏิทิน — อันดับแรก เด่นที่สุด ===== */}
      {loadingGroups ? (
        <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-400">
          กำลังโหลดข้อมูล...
        </div>
      ) : (
        <DashboardCalendar events={events} />
      )}

      {/* ยังไม่มีกลุ่ม: แนะนำขั้นแรก */}
      {!loadingGroups && !loadFailed && userGroups.length === 0 && (
        <section className="gt-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
            <FolderOpen size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-800">ยังไม่มีกลุ่ม</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
            สร้างกลุ่มใหม่ถ้าคุณเป็นหัวหน้า หรือกรอกรหัส 6 ตัวที่ได้จากหัวหน้าเพื่อเข้าร่วมกลุ่ม
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              href="/dashboard/projects/new"
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 transition-all"
            >
              <Plus size={18} />
              สร้างกลุ่ม
            </Link>
            <Link
              href="/dashboard/projects/join"
              className="flex items-center gap-2 rounded-2xl border-2 border-indigo-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-all"
            >
              <UserPlus size={16} />
              เข้าร่วมด้วยรหัส
            </Link>
          </div>
        </section>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`gt-card p-5 flex flex-col gap-1 ${i === stats.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.iconClass}`}>
              <s.icon size={18} />
            </span>
            <span className={`text-[28px] font-bold bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>
              {s.value}
            </span>
            <span className="text-[12px] text-slate-500">{s.label}</span>
          </div>
        ))}
      </div>

      {/* กลุ่มที่คุณสร้าง/เข้าร่วมจริง (Real Groups จาก Supabase) */}
      {userGroups.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-slate-800 flex items-center gap-2">
              <Sparkles size={18} className="text-amber-500" />
              กลุ่มของคุณในระบบ ({userGroups.length})
            </h2>
            <Link
              href="/dashboard/projects/new"
              className="text-[12px] font-semibold text-indigo-600 hover:underline"
            >
              + สร้างกลุ่มเพิ่ม
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {userGroups.map((g) => (
              <div
                key={g.group_id}
                className="gt-card p-5 flex flex-col justify-between border-2 border-indigo-100 bg-gradient-to-br from-white via-indigo-50/20 to-purple-50/30 hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      g.role === 'leader'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {g.role === 'leader' ? <Crown size={12} /> : <User size={12} />}
                      {g.role === 'leader' ? 'หัวหน้ากลุ่ม' : 'สมาชิก'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      รหัส: <strong className="text-indigo-600 tracking-wider">{g.join_code}</strong>
                    </span>
                  </div>

                  <h3 className="text-[16px] font-bold text-slate-800">{g.group_name}</h3>
                  <p className="mt-1 text-[12px] text-slate-500 line-clamp-2">
                    {g.description || 'ไม่มีคำอธิบายโครงการ'}
                  </p>
                  {unreadCounts[g.group_id] > 0 && (
                    <span className="mt-2 inline-block rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                      มี {unreadCounts[g.group_id]} การเปลี่ยนแปลงใหม่
                    </span>
                  )}

                  {/* หลอดความคืบหน้าของโครงการ */}
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="text-slate-500">ความคืบหน้า</span>
                      <span className="font-semibold text-indigo-600">{groupProgress[g.group_id] ?? 0}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                        style={{ width: `${groupProgress[g.group_id] ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400">
                    {g.work_mode === 'leader_all' && 'หัวหน้าคุม'}
                    {g.work_mode === 'member_choose' && 'สมาชิกเลือก'}
                    {g.work_mode === 'mixed' && 'แบบผสม'}
                  </span>
                  <Link
                    href={`/dashboard/groups/${g.group_id}`}
                    className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline"
                  >
                    เปิดดูโครงการ
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      {recentLogs.length > 0 && (
        <section className="gt-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-[16px] font-bold text-slate-800">
            <Clock size={18} className="text-indigo-500" />
            กิจกรรมล่าสุด
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentLogs.map((log) => {
              const style = ACTION_STYLE[log.action_type] ?? { icon: RefreshCw, className: 'bg-indigo-100 text-indigo-600' };
              return (
                <Link
                  key={log.log_id}
                  href={`/dashboard/groups/${log.group_id}`}
                  className="flex gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:border-indigo-200 transition"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.className}`}>
                    <style.icon size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-700 leading-snug">
                      {ACTION_LABEL[log.action_type] ?? log.action_type}
                      {log.payload?.title ? ` "${log.payload.title}"` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {userGroups.find((g) => g.group_id === log.group_id)?.group_name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(log.created_at).toLocaleDateString('th-TH', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
