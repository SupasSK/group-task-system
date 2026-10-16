'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Users,
  Copy,
  Check,
  ShieldCheck,
  Calendar,
  Clock,
  LayoutGrid,
  Activity,
  Award,
  CheckCircle2,
  Crown,
  FolderOpen,
  ClipboardList,
  CircleDashed,
  PlayCircle,
  User,
  Lightbulb,
  ArrowRight,
} from 'lucide-react';
import { createClient } from '@/utils/supabase';
import { projectProgress } from '@/lib/projectProgress';
import ParticipationSummary from '@/components/dashboard/ParticipationSummary';
import CatchUpDigest from '@/components/dashboard/CatchUpDigest';

interface RealLeaderGroup {
  group_id: string;
  group_name: string;
  description: string;
  work_mode: string;
  join_code: string;
  created_at: string;
  members_count?: number;
}

interface KanbanTask {
  id: string;
  title: string;
  tag: string;
  tagColor: string;
  status: 'todo' | 'doing' | 'done';
  statusLabel: string;
  statusClass: string;
  deadline: string;
  overdue: boolean;
  assignee: string;
}

interface LeaderProject {
  id: string;
  title: string;
  description: string;
  progress: number;
  totalTasks: number;
  tasks: KanbanTask[];
  memberCount: number;
  // ข้อมูลดิบจากฐานข้อมูล สำหรับคำนวณคะแนนการมีส่วนร่วม
  raw: { members: any[]; tasks: any[]; responses: any[] };
}

type ProjectTab = 'tasks' | 'activity' | 'contributions';

// ป้ายสถานะตามค่าจริงในฐานข้อมูล
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'รอผู้รับ', className: 'bg-slate-100 text-slate-600' },
  assigned: { label: 'รอตอบรับ', className: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'ถูกปฏิเสธ', className: 'bg-rose-100 text-rose-700' },
  accepted: { label: 'รับแล้ว', className: 'bg-indigo-100 text-indigo-700' },
  in_progress: { label: 'กำลังทำ', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'เสร็จแล้ว', className: 'bg-emerald-100 text-emerald-700' },
};

const COLUMNS = [
  { key: 'todo', label: 'รอเริ่ม', headClass: 'bg-amber-100 text-amber-800', icon: CircleDashed, iconClass: 'text-slate-400', cardClass: 'border-slate-200/80 hover:border-slate-300' },
  { key: 'doing', label: 'กำลังทำ', headClass: 'bg-blue-100 text-blue-800', icon: PlayCircle, iconClass: 'text-blue-500', cardClass: 'border-blue-200/80 hover:border-blue-300' },
  { key: 'done', label: 'เสร็จแล้ว', headClass: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2, iconClass: 'text-emerald-500', cardClass: 'border-slate-200/80 hover:border-emerald-300 opacity-90 hover:opacity-100' },
] as const;

export default function LeaderPage() {
  const supabase = createClient();
  const [realLeaderGroups, setRealLeaderGroups] = useState<RealLeaderGroup[]>([]);
  const [realProjects, setRealProjects] = useState<LeaderProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // เก็บแท็บที่เลือกของแต่ละโครงการแยกกัน โดยค่าเริ่มต้นคือ 'tasks' (งานทั้งหมดในโครงการ)
  const [activeTabs, setActiveTabs] = useState<Record<string, ProjectTab>>({});

  useEffect(() => {
    loadLeaderGroups();
  }, []);

  const loadLeaderGroups = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);

      // 1. ดึงกลุ่มที่ตนเองเป็นผู้สร้าง หรือเป็นหัวหน้ากลุ่ม
      const { data: groupRows, error } = await supabase
        .from('groups')
        .select(`
          group_id,
          group_name,
          description,
          work_mode,
          join_code,
          created_at,
          created_by
        `)
        .eq('created_by', user.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false });

      if (error || !groupRows) {
        setLoading(false);
        return;
      }

      setRealLeaderGroups(groupRows || []);

      if (groupRows.length > 0) {
        const groupIds = groupRows.map((g: any) => g.group_id);

        // 2. ดึง tasks จริงทั้งหมดของกลุ่มเหล่านี้
        const { data: taskRows } = await supabase
          .from('tasks')
          .select('*')
          .in('group_id', groupIds)
          .order('created_at', { ascending: false });

        // 3. ดึงสมาชิกของกลุ่มเพื่อดึงชื่อผู้รับผิดชอบ
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('group_id, user_id, role')
          .in('group_id', groupIds);

        const memberUserIds = Array.from(new Set((memberRows || []).map((m: any) => m.user_id)));
        const userMap: Record<string, string> = {};
        const avatarMap: Record<string, string | null> = {};

        if (memberUserIds.length > 0) {
          const { data: userRows } = await supabase
            .from('users')
            .select('user_id, full_name, email, avatar_url, custom_avatar_url')
            .in('user_id', memberUserIds);

          (userRows || []).forEach((u: any) => {
            userMap[u.user_id] = u.full_name || u.email || 'สมาชิก';
            avatarMap[u.user_id] = u.custom_avatar_url || u.avatar_url || null;
          });
        }

        // ดึงการตอบรับ/ปฏิเสธงาน สำหรับคะแนนการมีส่วนร่วม
        const allTaskIds = (taskRows || []).map((t: any) => t.task_id);
        let responseRows: any[] = [];
        if (allTaskIds.length > 0) {
          const { data } = await supabase
            .from('task_responses')
            .select('task_id, user_id, response')
            .in('task_id', allTaskIds);
          responseRows = data || [];
        }

        const now = new Date();

        // 4. แปลงกลุ่มจริงเป็น LeaderProject พร้อม Kanban Board
        const mappedProjects: LeaderProject[] = groupRows.map((g: any) => {
          const groupTasks = (taskRows || []).filter((t: any) => t.group_id === g.group_id);

          const kanbanTasks: KanbanTask[] = groupTasks.map((t: any) => {
            let status: 'todo' | 'doing' | 'done' = 'todo';
            if (t.status === 'completed') {
              status = 'done';
            } else if (t.status === 'accepted' || t.status === 'in_progress') {
              status = 'doing';
            } else {
              status = 'todo';
            }

            const assigneeName = t.assigned_to ? (userMap[t.assigned_to] || 'สมาชิกในกลุ่ม') : 'ยังไม่มีผู้รับ';
            const deadlineText = t.deadline
              ? new Date(t.deadline).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })
              : 'ไม่ระบุ';
            const badge = STATUS_BADGE[t.status] || STATUS_BADGE.pending;

            return {
              id: t.task_id,
              title: t.title,
              tag: t.assignment_type === 'open_choice' ? 'เปิดให้เลือก' : 'มอบหมาย',
              tagColor: t.assignment_type === 'open_choice' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800',
              status,
              statusLabel: badge.label,
              statusClass: badge.className,
              deadline: deadlineText,
              overdue:
                !!t.deadline && new Date(t.deadline) < now && t.status !== 'completed' && t.status !== 'rejected',
              assignee: assigneeName,
            };
          });

          const groupMembers = (memberRows || []).filter((m: any) => m.group_id === g.group_id);

          return {
            id: g.group_id,
            title: g.group_name,
            description: g.description || 'โครงการบริหารงานกลุ่ม',
            progress: projectProgress(groupTasks),
            totalTasks: kanbanTasks.length,
            tasks: kanbanTasks,
            memberCount: groupMembers.length,
            raw: {
              members: groupMembers.map((m: any) => ({
                user_id: m.user_id,
                role: m.role,
                full_name: userMap[m.user_id] || null,
                email: null,
                avatar: avatarMap[m.user_id] ?? null,
              })),
              tasks: groupTasks,
              responses: responseRows.filter((r: any) =>
                groupTasks.some((t: any) => t.task_id === r.task_id)
              ),
            },
          };
        });

        setRealProjects(mappedProjects);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleTabChange = (projectId: string, tab: ProjectTab) => {
    setActiveTabs((prev) => ({
      ...prev,
      [projectId]: tab,
    }));
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[28px] font-bold text-slate-800">
            <Crown size={26} className="text-amber-500" />
            มุมมองหัวหน้า
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            จัดการกลุ่ม มอบหมายงาน ติดตามความคืบหน้ารูปแบบบอร์ด และสรุปผลการมีส่วนร่วม
          </p>
        </div>

        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 hover:scale-[1.02] transition-all"
        >
          <Plus size={18} />
          <span>สร้างกลุ่มใหม่</span>
        </Link>
      </div>

      {loading && (
        <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-400">
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* ยังไม่มีกลุ่มที่เป็นหัวหน้า */}
      {!loading && realLeaderGroups.length === 0 && (
        <section className="gt-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <Crown size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-800">ยังไม่มีกลุ่มที่คุณเป็นหัวหน้า</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
            สร้างกลุ่มใหม่แล้วแชร์รหัสเข้าร่วม 6 ตัวให้เพื่อนในทีม
          </p>
          <Link
            href="/dashboard/projects/new"
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 transition-all"
          >
            <Plus size={18} />
            สร้างกลุ่ม
          </Link>
        </section>
      )}

      {/* รายการกลุ่มจริงที่คุณสร้าง (Real Supabase Groups) */}
      {realLeaderGroups.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck size={20} className="text-amber-500" />
              กลุ่มที่คุณเป็นหัวหน้า ({realLeaderGroups.length} กลุ่ม)
            </h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {realLeaderGroups.map((g) => (
              <div
                key={g.group_id}
                className="gt-card p-6 border-2 border-indigo-100/80 bg-gradient-to-br from-white to-purple-50/20 flex flex-col justify-between hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                      <Crown size={12} />
                      คุณเป็นหัวหน้า
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {g.work_mode === 'leader_all' ? 'หัวหน้าคุม' : g.work_mode === 'member_choose' ? 'สมาชิกเลือก' : 'แบบผสม'}
                    </span>
                  </div>

                  <h3 className="text-[18px] font-bold text-slate-800 mt-2 line-clamp-1">
                    {g.group_name}
                  </h3>
                  <p className="text-[13px] text-slate-500 mt-1 line-clamp-2">
                    {g.description || 'ไม่มีคำอธิบายโครงการ'}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
                  {/* กล่องรหัสเข้าร่วมกลุ่ม */}
                  <div className="flex items-center justify-between bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-100">
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase font-semibold">รหัสเข้าร่วมกลุ่ม</span>
                      <span className="text-[16px] font-bold tracking-widest text-indigo-700">
                        {g.join_code}
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(g.join_code)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-indigo-600 text-[12px] font-medium shadow-sm hover:bg-indigo-600 hover:text-white transition"
                    >
                      {copiedCode === g.join_code ? (
                        <>
                          <Check size={14} className="text-emerald-500" />
                          <span>คัดลอกแล้ว</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          <span>คัดลอกรหัส</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <Link
                      href={`/dashboard/groups/${g.group_id}`}
                      className="inline-flex items-center gap-1 text-indigo-600 font-semibold hover:underline"
                    >
                      เข้าสู่ห้องกลุ่ม <ArrowRight size={14} />
                    </Link>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/groups/${g.group_id}?tab=members`}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 transition"
                      >
                        <Users size={13} />
                        เพิ่มสมาชิก
                      </Link>
                      <Link
                        href={`/dashboard/groups/${g.group_id}?tab=tasks&new=1`}
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium text-[12px]"
                      >
                        <Plus size={13} />
                        มอบหมายงาน
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* โครงการและเครื่องมือจัดการงาน */}
      {realProjects.length > 0 && (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold text-slate-800">
            ภาพรวมโครงการที่คุณดูแล ({realProjects.length} โครงการ)
          </h2>
        </div>

        {realProjects.map((proj) => {
          const currentTab = activeTabs[proj.id] || 'tasks';
          const newTaskHref = `/dashboard/groups/${proj.id}?tab=tasks&new=1`;

          return (
            <section key={proj.id} className="gt-card p-4 sm:p-6 space-y-6 border border-slate-100 shadow-sm">
              {/* Project Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2.5">
                    <FolderOpen size={24} className="shrink-0 text-indigo-500" />
                    <h2 className="text-[22px] font-bold text-slate-800">{proj.title}</h2>
                  </div>
                  <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{proj.description}</p>
                  <div className="mt-3 flex items-center gap-4 text-[13px] font-medium text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <ClipboardList size={15} className="text-slate-400" />
                      {proj.totalTasks} งานทั้งหมด
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users size={15} className="text-slate-400" />
                      {proj.memberCount} สมาชิก
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="flex items-baseline justify-end gap-1">
                    <span className="text-[12px] font-semibold text-slate-400">ความคืบหน้า</span>
                    <span className="text-[32px] font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
                      {proj.progress}%
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 w-32 rounded-full bg-slate-100 overflow-hidden ml-auto">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${proj.progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* แถบแท็บ 3 เมนูในแต่ละโครงการ */}
              <div className="flex gap-5 sm:gap-6 overflow-x-auto border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => handleTabChange(proj.id, 'tasks')}
                  className={`shrink-0 whitespace-nowrap pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
                    currentTab === 'tasks'
                      ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                      : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
                  }`}
                >
                  <LayoutGrid size={16} />
                  <span>งานทั้งหมดในโครงการ</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    currentTab === 'tasks' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {proj.tasks.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange(proj.id, 'activity')}
                  className={`shrink-0 whitespace-nowrap pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
                    currentTab === 'activity'
                      ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                      : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
                  }`}
                >
                  <Activity size={16} />
                  <span>ประวัติกิจกรรม</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange(proj.id, 'contributions')}
                  className={`shrink-0 whitespace-nowrap pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
                    currentTab === 'contributions'
                      ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                      : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
                  }`}
                >
                  <Award size={16} />
                  <span>ผลการมีส่วนร่วม</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    currentTab === 'contributions' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {proj.memberCount} สมาชิก
                  </span>
                </button>
              </div>

              {/* ===== แท็บที่ 1: งานทั้งหมดในโครงการ (บอร์ดงาน) ===== */}
              {currentTab === 'tasks' && (
                <div className="space-y-4">
                  {/* แถบหัวบอร์ด */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
                        <LayoutGrid size={15} className="text-slate-500" />
                        บอร์ดงาน
                      </span>
                      <span className="text-[12px] text-slate-400">แยกตามสถานะ แก้ไขงานได้ในห้องกลุ่ม</span>
                    </div>
                    <Link
                      href={newTaskHref}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 shadow-sm transition"
                    >
                      <Plus size={14} />
                      <span>สร้างงาน</span>
                    </Link>
                  </div>

                  {/* คอลัมน์บอร์ดงาน */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {COLUMNS.map((col) => {
                      const colTasks = proj.tasks.filter((t) => t.status === col.key);
                      const CardIcon = col.icon;

                      return (
                        <div
                          key={col.key}
                          className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200/70 flex flex-col md:min-h-[350px]"
                        >
                          {/* Column Header */}
                          <div className="flex items-center gap-2 mb-3 px-1">
                            <span className={`px-2 py-0.5 rounded-md text-[12px] font-bold ${col.headClass}`}>
                              {col.label}
                            </span>
                            <span className="text-[12px] text-slate-400 font-medium">{colTasks.length}</span>
                          </div>

                          {/* Cards List */}
                          <div className="space-y-3 flex-1">
                            {colTasks.length === 0 && col.key !== 'todo' && (
                              <p className="py-4 text-center text-[12px] text-slate-400">ไม่มีงาน</p>
                            )}

                            {colTasks.map((t) => (
                              <div
                                key={t.id}
                                className={`bg-white rounded-xl p-3.5 border shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all duration-200 space-y-2.5 ${col.cardClass}`}
                              >
                                <div className="flex items-start gap-2">
                                  <CardIcon size={16} className={`mt-0.5 shrink-0 ${col.iconClass}`} />
                                  <h4
                                    className={`text-[13px] font-semibold leading-snug ${
                                      col.key === 'done' ? 'text-slate-700 line-through' : 'text-slate-800'
                                    }`}
                                  >
                                    {t.title}
                                  </h4>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${t.tagColor}`}>
                                    {t.tag}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                    <User size={10} />
                                    {t.assignee}
                                  </span>
                                </div>

                                {/* กำหนดส่งและสถานะ */}
                                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                                  <span
                                    className={`flex items-center gap-1 font-medium ${
                                      t.overdue ? 'text-rose-600' : 'text-slate-500'
                                    }`}
                                  >
                                    {col.key === 'done' ? (
                                      <CheckCircle2 size={12} className="text-emerald-500" />
                                    ) : col.key === 'doing' ? (
                                      <Clock size={12} className="text-blue-500" />
                                    ) : (
                                      <Calendar size={12} className="text-indigo-500" />
                                    )}
                                    กำหนดส่ง: {t.deadline}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    {t.overdue && (
                                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                        เลยกำหนด
                                      </span>
                                    )}
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.statusClass}`}>
                                      {t.statusLabel}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            ))}

                            {col.key === 'todo' && (
                              <Link
                                href={newTaskHref}
                                className="w-full py-2 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-400 hover:text-indigo-600 text-[12px] font-medium flex items-center justify-center gap-1 transition"
                              >
                                <Plus size={14} />
                                <span>สร้างงาน</span>
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ===== แท็บที่ 2: ประวัติกิจกรรม ===== */}
              {currentTab === 'activity' && (
                <div className="space-y-4">
                  <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-[14px] font-bold text-slate-800 flex items-center gap-2">
                        <Activity size={16} className="text-indigo-600" />
                        ประวัติกิจกรรมล่าสุดในโครงการ
                      </h3>
                      <p className="text-[12px] text-slate-500 mt-0.5">
                        การเปลี่ยนแปลงสถานะงาน การส่งงาน และการมอบหมายงานโดยสมาชิก
                      </p>
                    </div>
                  </div>

                  {currentUserId && (
                    <CatchUpDigest
                      groupId={proj.id}
                      currentUserId={currentUserId}
                      members={proj.raw.members}
                      trackVisit={false}
                    />
                  )}
                </div>
              )}

              {/* ===== แท็บที่ 3: ผลการมีส่วนร่วม ===== */}
              {currentTab === 'contributions' && (
                <div className="space-y-5">
                  <div className="grid gap-5 lg:grid-cols-3">
                    {/* รายงานสมาชิก (Members Report) */}
                    <div className="lg:col-span-2">
                      <ParticipationSummary
                        groupId={proj.id}
                        members={proj.raw.members}
                        tasks={proj.raw.tasks}
                        taskResponses={proj.raw.responses}
                        showPeerEval
                      />
                    </div>

                    {/* เครื่องมือมอบหมายงานและสรุปยอด */}
                    <div className="space-y-4">
                      <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 space-y-3">
                        <h4 className="text-[13px] font-bold text-slate-700">จัดการและมอบหมายงาน</h4>
                        <Link
                          href={newTaskHref}
                          className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2.5 text-[12px] font-semibold text-white hover:opacity-90 transition shadow-sm"
                        >
                          <Plus size={14} />
                          สร้างงาน / มอบหมายงาน
                        </Link>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          เลือกได้ในฟอร์มว่าจะมอบหมายให้สมาชิก หรือเปิดให้สมาชิกเลือกรับเอง
                        </p>
                      </div>

                      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-4 text-white space-y-2">
                        <h4 className="text-[13px] font-bold flex items-center gap-1.5">
                          <Lightbulb size={15} />
                          คำแนะนำสำหรับหัวหน้า
                        </h4>
                        <p className="text-[11px] text-indigo-100 leading-relaxed">
                          กำหนดส่งและความยากของงานให้ชัดเจน และกระจายงานให้สมาชิกใกล้เคียงกัน ดูภาระงานค้างของแต่ละคนได้ที่แท็บสมาชิกในห้องกลุ่ม
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      )}
    </div>
  );
}
