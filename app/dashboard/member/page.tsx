'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  UserPlus,
  Plus,
  CheckCircle2,
  Clock,
  Award,
  Users,
  Briefcase,
  FolderKanban,
  AlertCircle,
  PlayCircle,
  Calendar,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { createClient } from '@/utils/supabase';
import { logActivity } from '@/lib/logActivity';

interface RealGroup {
  group_id: string;
  group_name: string;
  description: string;
  work_mode: string;
  join_code: string;
  role: string;
}

interface MemberTask {
  task_id: string;
  group_id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assignment_type: 'leader_assign' | 'open_choice';
  assigned_to: string | null;
  assigned_by: string | null;
  deadline: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  group_name?: string;
}

const PRIORITY_CONFIG: Record<MemberTask['priority'], { label: string; className: string }> = {
  low: { label: 'ต่ำ', className: 'bg-slate-100 text-slate-700' },
  medium: { label: 'กลาง', className: 'bg-blue-100 text-blue-700' },
  high: { label: 'สูง', className: 'bg-amber-100 text-amber-800' },
  urgent: { label: 'ด่วน', className: 'bg-rose-100 text-rose-700 font-bold' },
};

const STATUS_CONFIG: Record<MemberTask['status'], { label: string; className: string }> = {
  pending: { label: 'รอผู้รับ', className: 'bg-slate-100 text-slate-700' },
  assigned: { label: 'รอตอบรับ', className: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'รับแล้ว', className: 'bg-indigo-100 text-indigo-700' },
  in_progress: { label: 'กำลังทำ', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'เสร็จแล้ว', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'ถูกปฏิเสธ', className: 'bg-rose-100 text-rose-700' },
};

function formatThaiDate(dateStr: string | null) {
  if (!dateStr) return 'ไม่ระบุ';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

type MemberTabType = 'my_tasks' | 'open_tasks' | 'completed_tasks';

export default function MemberPage() {
  const supabase = createClient();
  const [realGroups, setRealGroups] = useState<RealGroup[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MemberTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [activeTab, setActiveTab] = useState<MemberTabType>('my_tasks');

  // ปฏิเสธงานโมดอล
  const [rejectModalTask, setRejectModalTask] = useState<MemberTask | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);

      // 1. ดึงกลุ่มที่ตนเองเป็นสมาชิก
      const { data: memberData, error: memberErr } = await supabase
        .from('group_members')
        .select(`
          role,
          groups (
            group_id,
            group_name,
            description,
            work_mode,
            join_code
          )
        `)
        .eq('user_id', user.id);

      if (memberErr || !memberData) {
        setLoading(false);
        return;
      }

      const mappedGroups: RealGroup[] = memberData
        .filter((item: any) => item.groups)
        .map((item: any) => ({
          group_id: item.groups.group_id,
          group_name: item.groups.group_name,
          description: item.groups.description || '',
          work_mode: item.groups.work_mode,
          join_code: item.groups.join_code,
          role: item.role,
        }));

      setRealGroups(mappedGroups);

      // 2. ดึง tasks จากกลุ่มที่ตนเองเป็นสมาชิก
      if (mappedGroups.length > 0) {
        const groupIds = mappedGroups.map((g) => g.group_id);
        const groupMap: Record<string, string> = {};
        mappedGroups.forEach((g) => {
          groupMap[g.group_id] = g.group_name;
        });

        const { data: taskRows, error: taskErr } = await supabase
          .from('tasks')
          .select('*')
          .in('group_id', groupIds)
          .order('created_at', { ascending: false });

        if (!taskErr && taskRows) {
          const mappedTasks: MemberTask[] = taskRows.map((t: any) => ({
            ...t,
            group_name: groupMap[t.group_id] || 'กลุ่มงาน',
          }));
          setTasks(mappedTasks);
        }
      } else {
        setTasks([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ===== สมาชิกกดเลือกงาน (open_choice -> in_progress) =====
  const handleClaimTask = async (task: MemberTask) => {
    if (!currentUserId) return;
    setActionMessage(null);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        assigned_to: currentUserId,
        status: 'in_progress',
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id);

    if (updateErr) {
      setActionMessage({ type: 'error', text: `เลือกรับงานไม่สำเร็จ: ${updateErr.message}` });
      return;
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_claimed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title },
    });

    setActionMessage({ type: 'success', text: `คุณได้เลือกรับงาน "${task.title}" แล้ว สถานะเปลี่ยนเป็น "กำลังทำ"` });
    await loadData();
    setActiveTab('my_tasks');
  };

  // ===== สมาชิกตอบรับงาน (assigned -> accepted) =====
  const handleAcceptTask = async (task: MemberTask) => {
    if (!currentUserId) return;
    setActionMessage(null);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'accepted',
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id);

    if (updateErr) {
      setActionMessage({ type: 'error', text: `รับงานไม่สำเร็จ: ${updateErr.message}` });
      return;
    }

    await supabase.from('task_responses').insert({
      task_id: task.task_id,
      user_id: currentUserId,
      response: 'accepted',
    });

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_accepted',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title },
    });

    setActionMessage({ type: 'success', text: `คุณได้รับงาน "${task.title}" แล้ว` });
    await loadData();
  };

  // ===== สมาชิกเริ่มทำงาน (accepted -> in_progress) =====
  const handleStartTask = async (task: MemberTask) => {
    setActionMessage(null);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'in_progress',
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id);

    if (updateErr) {
      setActionMessage({ type: 'error', text: `เริ่มทำงานไม่สำเร็จ: ${updateErr.message}` });
      return;
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, from: task.status, to: 'in_progress' },
    });

    setActionMessage({ type: 'success', text: `เริ่มดำเนินงาน "${task.title}" แล้ว (กำลังทำ)` });
    await loadData();
  };

  // ===== สมาชิกกดยืนยันว่างานเสร็จแล้ว (-> completed) =====
  const handleCompleteTask = async (task: MemberTask) => {
    setActionMessage(null);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('task_id', task.task_id);

    if (updateErr) {
      setActionMessage({ type: 'error', text: `บันทึกงานเสร็จไม่สำเร็จ: ${updateErr.message}` });
      return;
    }

    await logActivity(supabase, {
      groupId: task.group_id,
      action: 'task_status_changed',
      entityType: 'task',
      entityId: task.task_id,
      payload: { title: task.title, from: task.status, to: 'completed' },
    });

    setActionMessage({ type: 'success', text: `ยอดเยี่ยม! คุณได้ทำงาน "${task.title}" เสร็จสิ้นเรียบร้อยแล้ว` });
    await loadData();
  };

  // ===== สมาชิกยืนยันปฏิเสธงาน =====
  const handleConfirmReject = async () => {
    if (!rejectModalTask || !currentUserId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setActionMessage({ type: 'error', text: 'กรุณากรอกเหตุผลในการปฏิเสธงาน' });
      return;
    }

    setRejectLoading(true);
    setActionMessage(null);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('tasks')
      .update({
        status: 'rejected',
        updated_at: nowIso,
      })
      .eq('task_id', rejectModalTask.task_id);

    if (updateErr) {
      setActionMessage({ type: 'error', text: `ปฏิเสธงานไม่สำเร็จ: ${updateErr.message}` });
      setRejectLoading(false);
      return;
    }

    await supabase.from('task_responses').insert({
      task_id: rejectModalTask.task_id,
      user_id: currentUserId,
      response: 'rejected',
      note: reason,
    });

    await logActivity(supabase, {
      groupId: rejectModalTask.group_id,
      action: 'task_declined',
      entityType: 'task',
      entityId: rejectModalTask.task_id,
      payload: { title: rejectModalTask.title, reason },
    });

    setActionMessage({ type: 'info', text: `ปฏิเสธงาน "${rejectModalTask.title}" เรียบร้อยแล้ว` });
    setRejectModalTask(null);
    setRejectReason('');
    await loadData();
    setRejectLoading(false);
  };

  // แบ่งกลุ่มงาน
  const myTasks = tasks.filter(
    (t) => t.assigned_to === currentUserId && t.status !== 'completed' && t.status !== 'rejected'
  );
  const openTasks = tasks.filter(
    (t) => t.assignment_type === 'open_choice' && t.status === 'pending' && !t.assigned_to
  );
  const completedTasks = tasks.filter(
    (t) => t.assigned_to === currentUserId && t.status === 'completed'
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800">👤 มุมมองสมาชิก</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            เลือกรับงานใหม่ ดำเนินงานที่ได้รับมอบหมาย และส่งงานเมื่อเสร็จสิ้น
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/projects/join"
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 hover:scale-[1.02] transition-all"
          >
            <UserPlus size={18} />
            <span>+ เข้าร่วมกลุ่มด้วยรหัส</span>
          </Link>
        </div>
      </div>

      {/* ข้อความแจ้งเตือนผลการดำเนินงาน */}
      {actionMessage && (
        <div
          className={`px-4 py-3 rounded-2xl text-sm ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : actionMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* สรุปสถิติงานของลูกทีม */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="gt-card p-5 border border-slate-100 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">งานที่คุณกำลังทำ / ถืออยู่</p>
            <p className="text-2xl font-bold text-slate-800 mt-0.5">{myTasks.length} งาน</p>
          </div>
        </div>

        <div className="gt-card p-5 border border-slate-100 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Briefcase size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">งานว่างที่รอคนเลือกรับ</p>
            <p className="text-2xl font-bold text-slate-800 mt-0.5">{openTasks.length} งาน</p>
          </div>
        </div>

        <div className="gt-card p-5 border border-slate-100 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">งานที่คุณทำสำเร็จแล้ว</p>
            <p className="text-2xl font-bold text-emerald-600 mt-0.5">{completedTasks.length} งาน</p>
          </div>
        </div>
      </div>

      {/* แท็บสำหรับสมาชิก (แท็บงานที่ลูกทีมต้องรู้) */}
      <div className="gt-card p-6 space-y-6 border border-slate-100">
        <div className="flex gap-6 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('my_tasks')}
            className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'my_tasks'
                ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <Briefcase size={16} />
            <span>งานของฉัน (กำลังทำ/รอทำ)</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                activeTab === 'my_tasks'
                  ? 'bg-indigo-100 text-indigo-700 font-semibold'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {myTasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('open_tasks')}
            className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'open_tasks'
                ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <Sparkles size={16} />
            <span>งานว่างที่เลือกทำได้</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                activeTab === 'open_tasks'
                  ? 'bg-amber-100 text-amber-800 font-semibold'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {openTasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('completed_tasks')}
            className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'completed_tasks'
                ? 'border-b-2 border-indigo-600 font-bold text-indigo-600'
                : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <CheckCircle2 size={16} />
            <span>งานที่ทำเสร็จแล้ว</span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                activeTab === 'completed_tasks'
                  ? 'bg-emerald-100 text-emerald-700 font-semibold'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {completedTasks.length}
            </span>
          </button>
        </div>

        {/* 1. แท็บงานของฉัน */}
        {activeTab === 'my_tasks' && (
          <div className="space-y-4">
            {myTasks.length === 0 ? (
              <div className="p-10 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-slate-100">
                <p className="text-sm">คุณยังไม่มีงานที่กำลังถืออยู่</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('open_tasks')}
                  className="mt-3 text-xs font-semibold text-indigo-600 hover:underline"
                >
                  ไปเลือกดูงานว่างในกลุ่ม →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {myTasks.map((t) => {
                  const priority = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
                  const status = STATUS_CONFIG[t.status] || STATUS_CONFIG.in_progress;

                  return (
                    <div
                      key={t.task_id}
                      className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-indigo-200 transition space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold">
                              📁 {t.group_name}
                            </span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${priority.className}`}>
                              {priority.label}
                            </span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${status.className}`}>
                              {status.label}
                            </span>
                          </div>
                          <h3 className="text-[15px] font-bold text-slate-800">{t.title}</h3>
                          {t.description && (
                            <p className="text-xs text-slate-500 leading-relaxed">{t.description}</p>
                          )}
                        </div>

                        <div className="text-right text-xs space-y-1">
                          <p className="text-slate-400">
                            กำหนดส่ง: <strong className="text-slate-700">{formatThaiDate(t.deadline)}</strong>
                          </p>
                        </div>
                      </div>

                      {/* ปุ่มการทำงาน: ตอบรับงาน / เริ่มทำงาน / กดยืนยันว่างานเสร็จแล้ว */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        <Link
                          href={`/dashboard/groups/${t.group_id}`}
                          className="text-xs text-indigo-600 font-medium hover:underline flex items-center gap-1"
                        >
                          ไปยังห้องกลุ่ม <ArrowRight size={12} />
                        </Link>

                        <div className="flex items-center gap-2">
                          {/* กรณียังไม่ได้ตอบรับ (assigned) */}
                          {t.status === 'assigned' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAcceptTask(t)}
                                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer shadow-xs"
                              >
                                รับงาน
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectModalTask(t);
                                  setRejectReason('');
                                }}
                                className="px-3.5 py-1.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                              >
                                ปฏิเสธ
                              </button>
                            </>
                          )}

                          {/* กรณีรับแล้วแต่ยังไม่เริ่ม (accepted) */}
                          {t.status === 'accepted' && (
                            <button
                              type="button"
                              onClick={() => handleStartTask(t)}
                              className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition cursor-pointer shadow-xs"
                            >
                              เริ่มทำงาน
                            </button>
                          )}

                          {/* กรณีกำลังทำ หรือรับแล้ว สามารถกดยืนยันว่าเสร็จแล้ว */}
                          {(t.status === 'in_progress' || t.status === 'accepted') && (
                            <button
                              type="button"
                              onClick={() => handleCompleteTask(t)}
                              className="px-4 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer shadow-xs flex items-center gap-1.5"
                            >
                              <CheckCircle2 size={14} />
                              <span>✅ งานเสร็จแล้ว</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 2. แท็บงานว่างที่เลือกทำได้ (Open Choice) */}
        {activeTab === 'open_tasks' && (
          <div className="space-y-4">
            {openTasks.length === 0 ? (
              <div className="p-10 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-slate-100">
                <p className="text-sm">ไม่มีงานว่างในขณะนี้</p>
                <p className="text-xs text-slate-400 mt-1">หัวหน้ากลุ่มยังไม่ได้เปิดรับงานใหม่ หรือสมาชิกเลือกรับไปหมดแล้ว</p>
              </div>
            ) : (
              <div className="space-y-3">
                {openTasks.map((t) => {
                  const priority = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
                  return (
                    <div
                      key={t.task_id}
                      className="p-4 rounded-2xl bg-white border border-amber-200/70 shadow-xs hover:border-amber-300 transition space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold">
                              📁 {t.group_name}
                            </span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${priority.className}`}>
                              {priority.label}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800">
                              🔓 รอสมาชิกเลือกทำ
                            </span>
                          </div>
                          <h3 className="text-[15px] font-bold text-slate-800">{t.title}</h3>
                          {t.description && (
                            <p className="text-xs text-slate-500 leading-relaxed">{t.description}</p>
                          )}
                        </div>

                        <div className="text-right text-xs">
                          <p className="text-slate-400">
                            กำหนดส่ง: <strong className="text-slate-700">{formatThaiDate(t.deadline)}</strong>
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">
                          เมื่อกดรับ งานจะย้ายไปที่สถานะ <strong>กำลังทำ</strong> ทันที
                        </span>
                        <button
                          type="button"
                          onClick={() => handleClaimTask(t)}
                          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-semibold hover:shadow-md transition cursor-pointer"
                        >
                          เลือกรับงานนี้
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 3. แท็บงานที่ทำเสร็จแล้ว */}
        {activeTab === 'completed_tasks' && (
          <div className="space-y-4">
            {completedTasks.length === 0 ? (
              <div className="p-10 text-center text-slate-400 bg-slate-50/50 rounded-2xl border border-slate-100">
                <p className="text-sm">ยังไม่มีงานที่คุณทำเสร็จ</p>
                <p className="text-xs text-slate-400 mt-1">เมื่อคุณส่งงานที่ได้รับมอบหมาย งานจะถูกบันทึกที่นี่</p>
              </div>
            ) : (
              <div className="space-y-3">
                {completedTasks.map((t) => (
                  <div
                    key={t.task_id}
                    className="p-4 rounded-2xl bg-emerald-50/30 border border-emerald-100 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold">
                            📁 {t.group_name}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800">
                            ✅ เสร็จสมบูรณ์
                          </span>
                        </div>
                        <h3 className="text-[14px] font-bold text-slate-800 mt-1 line-through opacity-85">
                          {t.title}
                        </h3>
                      </div>
                      <span className="text-xs text-emerald-700 font-medium whitespace-nowrap">
                        {t.completed_at ? `เสร็จเมื่อ: ${formatThaiDate(t.completed_at)}` : 'เสร็จแล้ว'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* กลุ่มจริงที่คุณเข้าร่วม */}
      {realGroups.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-slate-800 flex items-center gap-2">
              <Users size={20} className="text-indigo-600" />
              กลุ่มที่คุณเข้าร่วม ({realGroups.length})
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {realGroups.map((g) => (
              <div
                key={g.group_id}
                className="gt-card p-5 border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/30 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-[16px] font-bold text-slate-800 line-clamp-1">{g.group_name}</h3>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-700 flex-shrink-0">
                      {g.role === 'leader' ? '👑 หัวหน้า' : '👤 สมาชิก'}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 line-clamp-2">
                    {g.description || 'ไม่มีคำอธิบายโครงการ'}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400">
                    รหัส: <strong className="text-indigo-600 tracking-wider">{g.join_code}</strong>
                  </span>
                  <Link
                    href={`/dashboard/groups/${g.group_id}`}
                    className="text-indigo-600 font-semibold hover:underline"
                  >
                    ดูห้องกลุ่ม →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* โมดอลปฏิเสธงาน (สำหรับสมาชิก) */}
      {rejectModalTask && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-800">
              ปฏิเสธงาน: {rejectModalTask.title}
            </h3>
            <p className="text-xs text-gray-500">
              กรุณากรอกเหตุผลในการปฏิเสธงานนี้ เพื่อส่งให้หัวหน้าทราบ
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                เหตุผลในการปฏิเสธ <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="เช่น ภาระงานปัจจุบันเต็มแล้ว, ทักษะไม่ตรง..."
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRejectModalTask(null);
                  setRejectReason('');
                }}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs hover:bg-gray-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={rejectLoading || !rejectReason.trim()}
                className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition disabled:opacity-50"
              >
                {rejectLoading ? 'กำลังส่ง...' : 'ยืนยันปฏิเสธงาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
