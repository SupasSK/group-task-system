'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase';
import { isOverdue, toneOf, TONE } from '@/lib/statusTone';
import {
  Plus, UserPlus, FolderOpen, ClipboardList, Zap,
  CheckCircle2, AlertTriangle, Crown, Clock, Mail,
} from 'lucide-react';

interface SupabaseGroup {
  group_id: string;
  group_name: string;
  role?: string;
}

interface HomeTask {
  task_id: string;
  group_id: string;
  title: string;
  status: string;
  deadline: string | null;
  assigned_to: string | null;
  assignment_type: string;
  headcount?: number | null;
}

interface Collaborator {
  task_id: string;
  user_id: string;
  status: string;
}

const THAI_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// จำนวนวันจากวันนี้ถึงวันกำหนดส่ง (0 = วันนี้, ติดลบ = ผ่านไปแล้ว)
const dayOffset = (iso: string) =>
  Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(new Date()).getTime()) / 86400000);
const shortDate = (d: Date) => `${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`;

function dueText(t: HomeTask) {
  if (!t.deadline) return 'ไม่มีกำหนดส่ง';
  const d = new Date(t.deadline);
  const offset = dayOffset(t.deadline);
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (isOverdue(t)) return offset < 0 ? `เลยกำหนด ${-offset} วัน` : `เลยกำหนด (${time} น.)`;
  if (offset === 0) return `ส่งวันนี้ ${time} น.`;
  if (offset === 1) return `ส่งพรุ่งนี้ ${time} น.`;
  return `ส่ง ${THAI_WEEKDAYS[d.getDay()]} ${shortDate(d)}`;
}

const taskHref = (t: HomeTask) => `/dashboard/groups/${t.group_id}?tab=tasks&task=${t.task_id}`;

export default function DashboardPage() {
  const supabase = createClient();
  const [userGroups, setUserGroups] = useState<SupabaseGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [tasks, setTasks] = useState<HomeTask[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  // วันที่เลือกในแถบ 7 วัน (0 = วันนี้) null = ไม่ได้เลือก
  const [pickedDay, setPickedDay] = useState<number | null>(null);
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
      setCurrentUserId(user.id);

      // ชื่อที่แสดงอ่านจาก public.users (user_metadata ถูกทับด้วยชื่อจาก Google)
      const { data: profile } = await supabase
        .from('users')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();
      setFirstName((profile?.full_name || '').trim().split(/\s+/)[0] || '');

      // ดึงกลุ่มที่ผู้ใช้สร้าง หรือเป็นสมาชิก
      const { data: memberGroups, error } = await supabase
        .from('group_members')
        .select(`
          role,
          groups (
            group_id,
            group_name,
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
            role: item.role,
          }));
        setUserGroups(groups);

        const groupIds = groups.map((g) => g.group_id);
        if (groupIds.length > 0) {
          const { data: taskRows } = await supabase
            .from('tasks')
            .select('*')
            .in('group_id', groupIds);
          setTasks(taskRows || []);

          // อ่านอย่างเดียว: ใช้หาคำเชิญเป็นผู้ร่วมทำ และงานที่ฉันร่วมทำ
          const { data: collabRows } = await supabase
            .from('task_collaborators')
            .select('task_id, user_id, status')
            .in('group_id', groupIds);
          setCollaborators(collabRows || []);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGroups(false);
    }
  };

  const groupName = (id: string) => userGroups.find((g) => g.group_id === id)?.group_name ?? '';
  const leaderGroupIds = new Set(userGroups.filter((g) => g.role === 'leader').map((g) => g.group_id));
  const myCollabStatus = (taskId: string) =>
    collaborators.find((c) => c.task_id === taskId && c.user_id === currentUserId)?.status;
  const isOpenTask = (t: HomeTask) => t.status !== 'completed' && t.status !== 'rejected';

  // คำเชิญที่ฉันต้องตอบ: หัวหน้ามอบหมายให้ หรือชวนเป็นผู้ร่วมทำ
  const assignInvites = tasks.filter((t) => t.assigned_to === currentUserId && t.status === 'assigned');
  const collabInvites = tasks.filter((t) => isOpenTask(t) && myCollabStatus(t.task_id) === 'pending');
  const isInvite = (t: HomeTask) => assignInvites.includes(t) || collabInvites.includes(t);

  // งานที่ฉันรับทำแล้ว (คนหลักหรือผู้ร่วมทำที่ตอบรับ) รวมจากทุกกลุ่ม
  const accepted = tasks.filter(
    (t) =>
      ['accepted', 'in_progress', 'completed'].includes(t.status) &&
      (t.assigned_to === currentUserId || myCollabStatus(t.task_id) === 'accepted')
  );
  const overdue = accepted.filter((t) => isOverdue(t));
  const dueToday = accepted.filter(
    (t) => t.status !== 'completed' && t.deadline && dayOffset(t.deadline) === 0 && !isOverdue(t)
  );

  // สิ่งที่หัวหน้าต้องจัดการ: งานว่างที่ยังไม่มีคนรับ และงานที่สมาชิกปฏิเสธ
  const leaderTodos = tasks
    .filter((t) => leaderGroupIds.has(t.group_id))
    .flatMap((t) => {
      if (t.status === 'rejected') return [{ task: t, note: 'สมาชิกปฏิเสธ ต้องมอบหมายใหม่' }];
      if (t.status === 'pending' && t.assignment_type === 'open_choice' && !t.assigned_to)
        return [{ task: t, note: 'งานว่าง ยังไม่มีคนรับ' }];
      return [];
    });

  const urgentCount =
    assignInvites.length + collabInvites.length + overdue.length + dueToday.length + leaderTodos.length;

  // แถบ 7 วัน: งานของฉันที่ยังไม่เสร็จ (รวมคำเชิญ) ที่ครบกำหนดในวันนั้น
  const weekTasks = [...accepted.filter((t) => t.status !== 'completed'), ...assignInvites, ...collabInvites];
  const tasksOnDay = (i: number) => weekTasks.filter((t) => t.deadline && dayOffset(t.deadline) === i);
  const dateOf = (i: number) => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + i);
    return d;
  };
  const pickedTasks = pickedDay === null ? [] : tasksOnDay(pickedDay);

  // งานว่างให้เลือกรับ (นับแบบเดียวกับหน้าสมาชิก)
  const openCount = tasks.filter((t) => {
    if (t.assignment_type !== 'open_choice' || !isOpenTask(t)) return false;
    if (t.assigned_to === currentUserId || myCollabStatus(t.task_id)) return false;
    const taken = collaborators.filter((c) => c.task_id === t.task_id && c.status !== 'rejected').length;
    return (!t.assigned_to && t.status === 'pending') || taken < (t.headcount ?? 1) - 1;
  }).length;

  const stats = [
    { label: 'กลุ่มทั้งหมด', href: '/dashboard/groups', value: userGroups.length, icon: FolderOpen, tone: 'bg-slate-100 text-slate-700', num: 'text-slate-900' },
    { label: 'งานที่ฉันรับทำ', href: '/dashboard/my-tasks', value: accepted.length, icon: ClipboardList, tone: 'bg-slate-100 text-slate-700', num: 'text-slate-900' },
    { label: 'กำลังทำ', href: '/dashboard/my-tasks?tab=doing', value: accepted.filter((t) => toneOf(t) === 'doing').length, icon: Zap, tone: 'bg-sky-100 text-sky-700', num: 'text-sky-700' },
    { label: 'เสร็จแล้ว', href: '/dashboard/my-tasks?tab=done', value: accepted.filter((t) => t.status === 'completed').length, icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-700', num: 'text-emerald-700' },
    { label: 'เลยกำหนด', href: '/dashboard/my-tasks?tab=overdue', value: overdue.length, icon: AlertTriangle, tone: 'bg-rose-100 text-rose-700', num: 'text-rose-700' },
  ];

  const taskRow = (t: HomeTask, icon?: React.ReactNode) => {
    const tone = TONE[toneOf(t, isInvite(t))];
    return (
      <li key={t.task_id}>
        <Link href={taskHref(t)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-slate-900">{t.title}</p>
            <p className="text-[12px] text-slate-600">
              {groupName(t.group_id)} · <span className={isOverdue(t) ? 'font-semibold text-rose-700' : ''}>{dueText(t)}</span>
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone.badge}`}>{tone.label}</span>
        </Link>
      </li>
    );
  };

  const inviteRow = (t: HomeTask, text: string) => (
    <li key={`invite-${t.task_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Mail size={18} className="shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-slate-900">{t.title}</p>
        <p className="text-[12px] text-slate-600">{text} · {groupName(t.group_id)} · {dueText(t)}</p>
      </div>
      <Link href={taskHref(t)} className="gt-btn px-3 py-1.5 text-[13px]">
        ดูและตอบรับ
      </Link>
    </li>
  );

  if (loadingGroups) {
    return (
      <div className="gt-card flex h-[320px] items-center justify-center animate-pulse text-[13px] text-slate-500">
        กำลังโหลดข้อมูล...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ทักทาย + ปุ่มสร้าง/เข้ากลุ่ม */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900">สวัสดี{firstName ? ` ${firstName}` : ''}</h1>
          <p className="text-[14px] text-slate-700">
            {urgentCount > 0 ? `มี ${urgentCount} เรื่องที่ต้องจัดการตอนนี้` : 'ไม่มีเรื่องเร่งด่วน'}
          </p>
        </div>
        <Link href="/dashboard/projects/new" className="gt-btn inline-flex items-center gap-1.5 px-4 py-2 text-[14px]">
          <Plus size={16} /> สร้าง / เข้ากลุ่ม
        </Link>
      </div>

      {/* ยังไม่มีกลุ่ม: แนะนำขั้นแรก */}
      {!loadFailed && userGroups.length === 0 && (
        <section className="gt-card p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <FolderOpen size={24} />
          </div>
          <h2 className="text-[18px] font-bold text-slate-900">ยังไม่มีกลุ่ม</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-600">
            สร้างกลุ่มใหม่ถ้าคุณเป็นหัวหน้า หรือกรอกรหัส 6 ตัวที่ได้จากหัวหน้าเพื่อเข้าร่วมกลุ่ม
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/dashboard/projects/new" className="gt-btn inline-flex items-center gap-2 px-5 py-2.5 text-[14px]">
              <Plus size={18} />
              สร้างกลุ่ม
            </Link>
            <Link
              href="/dashboard/projects/join"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-slate-800 hover:bg-slate-50"
            >
              <UserPlus size={16} />
              เข้าร่วมด้วยรหัส
            </Link>
          </div>
        </section>
      )}

      {/* แถบ 7 วัน: กดวันเพื่อดูงานที่ต้องส่งวันนั้น (กดซ้ำเพื่อปิด) */}
      {userGroups.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }, (_, i) => {
              const d = dateOf(i);
              const items = tasksOnDay(i);
              const active = pickedDay === i;
              return (
                <button
                  key={i}
                  onClick={() => setPickedDay(active ? null : i)}
                  aria-pressed={active}
                  className={`rounded-xl border px-2 py-2 text-center ${
                    active
                      ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500'
                      : i === 0
                        ? 'border-violet-300 bg-white'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <p className={`text-[12px] font-medium ${i === 0 ? 'text-violet-700' : 'text-slate-600'}`}>
                    {i === 0 ? 'วันนี้' : THAI_WEEKDAYS[d.getDay()]}
                  </p>
                  <p className="text-[16px] font-bold text-slate-900">{d.getDate()}</p>
                  <div className="mt-1 flex h-2 justify-center gap-1">
                    {items.slice(0, 4).map((t) => (
                      <span key={t.task_id} className={`h-2 w-2 rounded-full ${TONE[toneOf(t, isInvite(t))].dot}`} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          {pickedDay !== null && (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-5 py-2.5 text-[13px] font-bold text-slate-900">
                งานที่ต้องส่ง
                {pickedDay === 0 ? 'วันนี้' : ` ${THAI_WEEKDAYS[dateOf(pickedDay).getDay()]} ${shortDate(dateOf(pickedDay))}`} ({pickedTasks.length})
              </p>
              {pickedTasks.length === 0 ? (
                <p className="px-5 py-3 text-[13px] text-slate-600">ไม่มีงานที่ต้องส่งวันนี้</p>
              ) : (
                <ul className="divide-y divide-slate-100">{pickedTasks.map((t) => taskRow(t))}</ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* ต้องจัดการตอนนี้ */}
      {urgentCount > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white">
          <h2 className="flex items-center gap-2 border-b border-amber-100 px-5 py-3 text-[15px] font-bold text-slate-900">
            <AlertTriangle size={17} className="text-amber-600" /> ต้องจัดการตอนนี้
          </h2>
          <ul className="divide-y divide-slate-100">
            {assignInvites.map((t) => inviteRow(t, 'หัวหน้ามอบหมายให้คุณ'))}
            {collabInvites.map((t) => inviteRow(t, 'ชวนคุณเป็นผู้ร่วมทำ'))}
            {overdue.map((t) => taskRow(t, <AlertTriangle size={18} className="shrink-0 text-rose-600" />))}
            {dueToday.map((t) => taskRow(t, <Clock size={18} className="shrink-0 text-sky-600" />))}
            {leaderTodos.map(({ task: t, note }) => (
              <li key={`leader-${t.task_id}`}>
                <Link href={taskHref(t)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                  <Crown size={18} className="shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-900">{t.title}</p>
                    <p className="text-[12px] text-slate-600">{note} · {groupName(t.group_id)}</p>
                  </div>
                  <span className="text-[13px] font-semibold text-violet-700">จัดการ →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ตัวเลขของงานที่ฉันรับทำ รวมจากทุกกลุ่ม (ไม่นับงานของคนอื่น และคำเชิญที่ยังไม่ตอบ) */}
      <section>
        <p className="mb-2 text-[13px] text-slate-600">งานของฉัน รวมจากทุกกลุ่ม</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map(({ label, href, value, icon: Icon, tone, num }) => (
            <Link
              key={label}
              href={href}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-violet-300"
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
                <Icon size={18} />
              </span>
              <p className={`mt-3 text-[26px] font-bold leading-none ${num}`}>{value}</p>
              <p className="mt-1 text-[13px] text-slate-700">{label}</p>
            </Link>
          ))}
        </div>
        {openCount > 0 && (
          <Link href="/dashboard/my-tasks?tab=open" className="mt-3 inline-block text-[13px] font-semibold text-violet-700 hover:underline">
            มีงานว่างให้เลือกรับ {openCount} งาน →
          </Link>
        )}
      </section>
    </div>
  );
}
