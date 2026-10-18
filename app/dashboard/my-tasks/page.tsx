'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import TaskWorkPanel from '@/components/dashboard/TaskWorkPanel';
import TaskTeamPanel, { type Collaborator } from '@/components/dashboard/TaskTeamPanel';
import { CheckCircle2, ArrowRight, Plus, Mail, FolderOpen, X } from 'lucide-react';
import { createClient } from '@/utils/supabase';
import { logActivity } from '@/lib/logActivity';
import { isOverdue, toneOf, TONE } from '@/lib/statusTone';

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
  work_url?: string | null;
  headcount?: number;
  created_at: string;
  updated_at: string;
  group_name?: string;
}

const PRIORITY_CONFIG: Record<MemberTask['priority'], { label: string; className: string }> = {
  low: { label: 'ต่ำ', className: 'border-slate-300 text-slate-700' },
  medium: { label: 'กลาง', className: 'border-slate-300 text-slate-700' },
  high: { label: 'สูง', className: 'border-slate-400 text-slate-900' },
  urgent: { label: 'ด่วน', className: 'border-rose-300 text-rose-700 font-bold' },
};

// สีตามชุดสีสถานะใน lib/statusTone.ts (ฟ้า = กำลังทำ, เหลือง = รอตอบรับ, เขียว = เสร็จ, เทา = ว่าง/ปฏิเสธ)
const STATUS_CONFIG: Record<MemberTask['status'], { label: string; className: string }> = {
  pending: { label: 'รอผู้รับ', className: 'bg-slate-100 text-slate-700' },
  assigned: { label: 'รอตอบรับ', className: 'bg-amber-100 text-amber-800' },
  accepted: { label: 'รับแล้ว', className: 'bg-sky-100 text-sky-800' },
  in_progress: { label: 'กำลังทำ', className: 'bg-sky-100 text-sky-800' },
  completed: { label: 'เสร็จแล้ว', className: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'ถูกปฏิเสธ', className: 'bg-slate-100 text-slate-700' },
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

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

type MyTab ='all' | 'doing' | 'overdue' | 'done' | 'open';
const TABS: { id: MyTab; label: string }[] = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'doing', label: 'กำลังทำ' },
  { id: 'overdue', label: 'เลยกำหนด' },
  { id: 'done', label: 'เสร็จแล้ว' },
  { id: 'open', label: 'งานว่างให้เลือกรับ' },
];

// useSearchParams ต้องอยู่ใต้ Suspense
export default function MyTasksPage() {
  return (
    <Suspense
      fallback={
        <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-500">
          กำลังโหลดข้อมูล...
        </div>
      }
    >
      <MyTasks />
    </Suspense>
  );
}

function MyTasks() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [realGroups, setRealGroups] = useState<RealGroup[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MemberTask[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  // โหลดครั้งแรกเสร็จแล้วหรือยัง (โหลดซ้ำหลังกดปุ่มจะไม่แสดงหน้าโหลด)
  const [loaded, setLoaded] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // เลือกแท็บจาก ?tab= (หน้าหลักลิงก์มาที่แท็บตามตัวเลขที่กด)
  const [activeTab, setActiveTab] = useState<MyTab>(() => {
    const tab = searchParams.get('tab');
    return TABS.some((t) => t.id === tab) ? (tab as MyTab) : 'all';
  });

  // งานที่เปิดดูรายละเอียดในหน้าต่าง
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

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
            join_code,
            archived_at
          )
        `)
        .eq('user_id', user.id);

      if (memberErr || !memberData) {
        setLoading(false);
        return;
      }

      const mappedGroups: RealGroup[] = memberData
        .filter((item: any) => item.groups && !item.groups.archived_at)
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

        const { data: collabRows } = await supabase
          .from('task_collaborators')
          .select('task_id, group_id, user_id, status, note')
          .in('group_id', groupIds);
        setCollaborators(collabRows || []);
      } else {
        setTasks([]);
        setCollaborators([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setLoaded(true);
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

    // ผู้ร่วมทำที่เลื่อนตัวเองเป็นผู้รับผิดชอบหลัก: เอาออกจากรายชื่อผู้ร่วมทำ
    if (collaborators.some((c) => c.task_id === task.task_id && c.user_id === currentUserId)) {
      await supabase.from('task_collaborators').delete().eq('task_id', task.task_id).eq('user_id', currentUserId);
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
    setActiveTab('doing');
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

  // แบ่งกลุ่มงาน (รวมงานที่เป็นผู้ร่วมทำ)
  const collabsOf = (taskId: string) => collaborators.filter((c) => c.task_id === taskId);
  const myCollabStatus = (taskId: string) =>
    collaborators.find((c) => c.task_id === taskId && c.user_id === currentUserId)?.status;
  const isMine = (t: MemberTask) =>
    t.assigned_to === currentUserId || myCollabStatus(t.task_id) === 'accepted';

  // คำเชิญที่ยังไม่ได้ตอบ: หัวหน้ามอบหมายให้ หรือชวนเป็นผู้ร่วมทำ (นับแบบเดียวกับหน้าหลัก)
  const invites = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'rejected' &&
      ((t.assigned_to === currentUserId && t.status === 'assigned') || myCollabStatus(t.task_id) === 'pending')
  );
  // งานที่ฉันรับทำแล้ว (คนหลักหรือผู้ร่วมทำที่ตอบรับ) ไม่รวมคำเชิญและงานที่ปฏิเสธ
  const mine = tasks.filter((t) => isMine(t) && t.status !== 'rejected' && !invites.includes(t));
  // งานว่าง: ยังไม่มีคนหลัก หรือยังมีที่ว่างสำหรับผู้ร่วมทำ
  const openTasks = tasks.filter((t) => {
    if (t.assignment_type !== 'open_choice' || t.status === 'completed' || t.status === 'rejected') return false;
    if (t.assigned_to === currentUserId || myCollabStatus(t.task_id)) return false;
    const taken = collabsOf(t.task_id).filter((c) => c.status !== 'rejected').length;
    return (!t.assigned_to && t.status === 'pending') || taken < (t.headcount ?? 1) - 1;
  });
  const lists: Record<MyTab, MemberTask[]> = {
    all: mine,
    doing: mine.filter((t) => toneOf(t) === 'doing'),
    overdue: mine.filter((t) => isOverdue(t)),
    done: mine.filter((t) => t.status === 'completed'),
    open: openTasks,
  };
  const list = lists[activeTab];
  const selectedTask = tasks.find((t) => t.task_id === selectedTaskId) ?? null;

  // การ์ดย่อแบบเดียวกับบอร์ดในแท็บงานของหน้ากลุ่ม กดแล้วเปิดรายละเอียดในหน้าต่าง
  const boardCard = (t: MemberTask) => {
    const invite = myCollabStatus(t.task_id) === 'pending';
    const awaitsMe = invite || (t.assigned_to === currentUserId && t.status === 'assigned');
    const tone = t.status === 'rejected' ? 'neutral' : toneOf(t, invite);
    return (
      <button
        key={t.task_id}
        type="button"
        onClick={() => {
          setActionMessage(null);
          setSelectedTaskId(t.task_id);
        }}
        className={`block w-full cursor-pointer rounded-xl border bg-white p-3 text-left shadow-sm hover:border-violet-300 ${
          tone === 'overdue' ? 'border-rose-300' : 'border-slate-200'
        }`}
      >
        <p className="truncate text-[12px] font-semibold text-slate-600">{t.group_name}</p>
        <p className="text-[14px] font-semibold leading-snug text-slate-900">{t.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
            {t.assignment_type === 'open_choice' ? 'เปิดให้เลือก' : 'มอบหมาย'}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-800">
            ความสำคัญ: {(PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium).label}
          </span>
          {awaitsMe && (
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TONE.waiting.badge}`}>รอคุณตอบ</span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className={`text-[12px] ${tone === 'overdue' ? 'font-semibold text-rose-700' : 'text-slate-600'}`}>
            {t.deadline ? `ส่ง ${formatShortDate(t.deadline)}` : 'ไม่มีกำหนดส่ง'}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone].badge}`}>
            {tone === 'overdue' ? TONE.overdue.label : (STATUS_CONFIG[t.status] || STATUS_CONFIG.pending).label}
          </span>
        </div>
      </button>
    );
  };

  // รายละเอียดงาน แสดงในหน้าต่างเมื่อกดการ์ด
  const taskDetail = (t: MemberTask) => {
    const priority = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.medium;
    const status = STATUS_CONFIG[t.status] || STATUS_CONFIG.in_progress;
    // หน้าต่างค้างเปิดหลังกดรับงาน จึงดูจากรายการงานว่างแทนแท็บที่เลือก
    const isOpen = openTasks.includes(t);

    return (
      <div key={t.task_id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-slate-600">{t.group_name}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${priority.className}`}>
                {priority.label}
              </span>
              {isOpen ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  รอสมาชิกเลือกทำ
                </span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              )}
              {isOverdue(t) && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                  เลยกำหนด
                </span>
              )}
            </div>
            <h3 className={`text-[15px] font-bold text-slate-900 ${t.status === 'completed' ? 'line-through opacity-80' : ''}`}>
              {t.title}
            </h3>
            {t.description && <p className="text-[13px] leading-relaxed text-slate-600">{t.description}</p>}
          </div>

          <p className="text-right text-[12px] text-slate-600">
            {t.status === 'completed' ? (
              <span className="font-medium text-emerald-700">
                {t.completed_at ? `เสร็จเมื่อ: ${formatThaiDate(t.completed_at)}` : 'เสร็จแล้ว'}
              </span>
            ) : (
              <>
                กำหนดส่ง:{' '}
                <strong className={isOverdue(t) ? 'text-rose-700' : 'text-slate-800'}>{formatThaiDate(t.deadline)}</strong>
              </>
            )}
          </p>
        </div>

        <TaskTeamPanel
          task={t}
          collaborators={collabsOf(t.task_id)}
          currentUserId={currentUserId}
          onChanged={loadData}
        />

        {!isOpen && <TaskWorkPanel task={t} currentUserId={currentUserId} canEdit={isMine(t)} />}

        {/* ปุ่มการทำงาน: เลือกรับ / ตอบรับ / ปฏิเสธ / เริ่มทำงาน / งานเสร็จแล้ว */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <Link
            href={`/dashboard/groups/${t.group_id}?tab=tasks`}
            className="flex items-center gap-1 text-[12px] font-medium text-slate-700 hover:text-violet-700 hover:underline"
          >
            ไปยังห้องกลุ่ม <ArrowRight size={12} />
          </Link>

          <div className="flex items-center gap-2">
            {isOpen && !t.assigned_to && (
              <button type="button" onClick={() => handleClaimTask(t)} className="gt-btn px-3.5 py-1.5 text-[12px]">
                {(t.headcount ?? 1) > 1 ? 'รับเป็นผู้รับผิดชอบหลัก' : 'เลือกรับงานนี้'}
              </button>
            )}

            {/* กรณียังไม่ได้ตอบรับ (assigned) — ผู้ร่วมทำตอบรับในส่วนทีมด้านบน */}
            {t.status === 'assigned' && t.assigned_to === currentUserId && (
              <>
                <button type="button" onClick={() => handleAcceptTask(t)} className="gt-btn px-3.5 py-1.5 text-[12px]">
                  รับงาน
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectModalTask(t);
                    setRejectReason('');
                  }}
                  className="cursor-pointer rounded-xl border border-rose-200 px-3.5 py-1.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-50"
                >
                  ปฏิเสธ
                </button>
              </>
            )}

            {/* กรณีรับแล้วแต่ยังไม่เริ่ม (accepted) */}
            {t.status === 'accepted' && isMine(t) && (
              <button type="button" onClick={() => handleStartTask(t)} className="gt-btn px-3.5 py-1.5 text-[12px]">
                เริ่มทำงาน
              </button>
            )}

            {/* กรณีกำลังทำ หรือรับแล้ว สามารถกดยืนยันว่าเสร็จแล้ว */}
            {(t.status === 'in_progress' || t.status === 'accepted') && t.assigned_to === currentUserId && (
              <button
                type="button"
                onClick={() => handleCompleteTask(t)}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700"
              >
                <CheckCircle2 size={14} />
                <span>งานเสร็จแล้ว</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ข้อความแจ้งเตือนผลการดำเนินงาน (แสดงในหน้าต่างรายละเอียดเมื่อเปิดอยู่)
  const messageBox = actionMessage && (
        <div
          className={`px-4 py-3 rounded-2xl text-sm ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : actionMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-slate-50 text-slate-800 border border-slate-200'
          }`}
        >
          {actionMessage.text}
        </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900">งานของฉัน</h1>
          <p className="text-[14px] text-slate-700">รวมจากทุกกลุ่ม</p>
        </div>
      </div>

      {!selectedTask && messageBox}

      {!loaded && (
        <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-500">
          กำลังโหลดข้อมูล...
        </div>
      )}

      {/* ยังไม่ได้เข้าร่วมกลุ่มใด */}
      {loaded && realGroups.length === 0 && (
        <section className="gt-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <FolderOpen size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-900">ยังไม่ได้เข้าร่วมกลุ่ม</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-600">
            กรอกรหัส 6 ตัวที่ได้จากหัวหน้ากลุ่ม แล้วงานของคุณจะแสดงที่หน้านี้
          </p>
          <Link href="/dashboard/projects/join" className="gt-btn mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-[14px]">
            <Plus size={18} />
            สร้าง / เข้ากลุ่ม
          </Link>
        </section>
      )}

      {loaded && realGroups.length > 0 && (
        <>
          {/* คำเชิญที่รอฉันตอบ (ไม่นับในแท็บ เหมือนตัวเลขบนหน้าหลัก) */}
          {invites.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                <Mail size={17} className="text-amber-600" /> รอคุณตอบรับ ({invites.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{invites.map(boardCard)}</div>
            </section>
          )}

          <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-200/70 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-[13px] ${
                  activeTab === t.id
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'font-medium text-slate-700 hover:text-slate-900'
                }`}
              >
                {t.label} <span className="text-slate-500">{lists[t.id].length}</span>
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-600">
              {activeTab === 'open' ? (
                <>
                  <p>ไม่มีงานว่างในขณะนี้</p>
                  <p className="mt-1 text-[12px]">หัวหน้ากลุ่มยังไม่ได้เปิดรับงานใหม่ หรือสมาชิกเลือกรับไปหมดแล้ว</p>
                </>
              ) : (
                <>
                  <p>ไม่มีงานในหมวดนี้</p>
                  {activeTab === 'all' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('open')}
                      className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline"
                    >
                      ไปเลือกดูงานว่างในกลุ่ม <ArrowRight size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{list.map(boardCard)}</div>
          )}
        </>
      )}

      {/* หน้าต่างรายละเอียดงาน: ปุ่มรับ/ปฏิเสธ/เริ่ม/เสร็จ ทีมงาน ลิงก์ผลงาน และความเห็นอยู่ในนี้ทั้งหมด */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-10"
          onClick={() => setSelectedTaskId(null)}
        >
          <div className="relative w-full max-w-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedTaskId(null)}
              aria-label="ปิด"
              className="absolute -top-9 right-0 rounded-full bg-white p-1.5 text-slate-700 shadow"
            >
              <X className="h-4 w-4" />
            </button>
            {messageBox}
            {taskDetail(selectedTask)}
          </div>
        </div>
      )}

      {/* โมดอลปฏิเสธงาน (สำหรับสมาชิก) */}
      {rejectModalTask && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              ปฏิเสธงาน: {rejectModalTask.title}
            </h3>
            <p className="text-xs text-slate-600">
              กรุณากรอกเหตุผลในการปฏิเสธงานนี้ เพื่อส่งให้หัวหน้าทราบ
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เหตุผลในการปฏิเสธ <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="เช่น ภาระงานปัจจุบันเต็มแล้ว, ทักษะไม่ตรง..."
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-sm"
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
                className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs hover:bg-slate-50 transition"
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
