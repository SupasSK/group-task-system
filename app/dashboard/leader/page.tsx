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
  AlertCircle,
  Tag,
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
  emoji: string;
  title: string;
  tag: string;
  tagColor: string;
  status: 'todo' | 'doing' | 'done';
  startDate: string;
  deadline: string;
  periodLabel: string; // เช่น '12 ต.ค. - 20 ต.ค.'
  timeStatus: 'early' | 'urgent' | 'completed' | 'normal';
  timeStatusLabel: string; // เช่น 'เหลืออีก 2 วัน (ช่วงเร่งด่วน)', 'เสร็จตรงเวลา'
  timeProgressPercent: number; // % ของช่วงเวลาที่ผ่านไป
  assignee: string;
}

interface LeaderProject {
  id: string;
  title: string;
  description: string;
  progress: number;
  totalTasks: number;
  tasks: KanbanTask[];
  members: {
    name: string;
    initials: string;
    color: string;
    assigned: number;
    done: number;
    pending: number;
    lastActivity: string;
  }[];
  activity: {
    icon: string;
    text: string;
    time: string;
  }[];
  // ข้อมูลดิบจากฐานข้อมูล สำหรับคำนวณคะแนนการมีส่วนร่วม (โครงการตัวอย่างไม่มี)
  raw?: { members: any[]; tasks: any[]; responses: any[] };
}

const DEFAULT_LEADER_PROJECTS: LeaderProject[] = [
  {
    id: 'p1',
    title: 'แอปพลิเคชันเดลิเวอรี่อาหาร',
    description: 'พัฒนาแอปสำหรับร้านอาหารในชุมชนให้ครอบคลุมรอบพื้นที่',
    progress: 75,
    totalTasks: 8,
    tasks: [
      // To Do
      {
        id: 't1',
        emoji: '🥪',
        title: 'เขียนเทสเคสระบบชำระเงิน',
        tag: 'QA & Test',
        tagColor: 'bg-amber-100 text-amber-800',
        status: 'todo',
        startDate: '18 ต.ค.',
        deadline: '25 ต.ค.',
        periodLabel: '18 ต.ค. – 25 ต.ค.',
        timeStatus: 'normal',
        timeStatusLabel: 'เหลืออีก 7 วัน (ช่วงเริ่มต้น)',
        timeProgressPercent: 15,
        assignee: 'วิภา ใจงาม',
      },
      {
        id: 't2',
        emoji: '🎨',
        title: 'ออกแบบหน้าโปรไฟล์ร้านค้า',
        tag: 'Design',
        tagColor: 'bg-purple-100 text-purple-800',
        status: 'todo',
        startDate: '20 ต.ค.',
        deadline: '27 ต.ค.',
        periodLabel: '20 ต.ค. – 27 ต.ค.',
        timeStatus: 'normal',
        timeStatusLabel: 'เหลืออีก 9 วัน (ช่วงวางแผน)',
        timeProgressPercent: 10,
        assignee: 'นที ทองดี',
      },
      {
        id: 't3',
        emoji: '🔔',
        title: 'เชื่อมต่อ Push Notification แจ้งเตือนออเดอร์',
        tag: 'Dev',
        tagColor: 'bg-blue-100 text-blue-800',
        status: 'todo',
        startDate: '22 ต.ค.',
        deadline: '29 ต.ค.',
        periodLabel: '22 ต.ค. – 29 ต.ค.',
        timeStatus: 'early',
        timeStatusLabel: 'เริ่มสัปดาห์หน้า',
        timeProgressPercent: 0,
        assignee: 'รอเปิดรับ',
      },
      // Doing
      {
        id: 't4',
        emoji: '💻',
        title: 'พัฒนาหน้าโปรไฟล์ผู้ใช้งานและประวัติคำสั่งซื้อ',
        tag: 'Frontend',
        tagColor: 'bg-blue-100 text-blue-800',
        status: 'doing',
        startDate: '12 ต.ค.',
        deadline: '20 ต.ค.',
        periodLabel: '12 ต.ค. – 20 ต.ค.',
        timeStatus: 'urgent',
        timeStatusLabel: '⚠️ เหลืออีก 2 วัน (ช่วงเร่งด่วน)',
        timeProgressPercent: 80,
        assignee: 'สมชาย พัฒนา',
      },
      {
        id: 't5',
        emoji: '🍔',
        title: 'ออกแบบ UI ระบบตะกร้าสินค้าและสรุปยอด',
        tag: 'UI/UX',
        tagColor: 'bg-rose-100 text-rose-800',
        status: 'doing',
        startDate: '10 ต.ค.',
        deadline: '19 ต.ค.',
        periodLabel: '10 ต.ค. – 19 ต.ค.',
        timeStatus: 'urgent',
        timeStatusLabel: '⚠️ เหลืออีก 1 วัน (ช่วงตรวจสอบรอบสุดท้าย)',
        timeProgressPercent: 90,
        assignee: 'นที ทองดี',
      },
      // Done
      {
        id: 't6',
        emoji: '📝',
        title: 'จัดทำเอกสาร Requirement V1 และ Business Flow',
        tag: 'Doc',
        tagColor: 'bg-emerald-100 text-emerald-800',
        status: 'done',
        startDate: '1 ต.ค.',
        deadline: '10 ต.ค.',
        periodLabel: '1 ต.ค. – 10 ต.ค.',
        timeStatus: 'completed',
        timeStatusLabel: '✅ เสร็จตรงตามกำหนด',
        timeProgressPercent: 100,
        assignee: 'วรัญญา มีสุข',
      },
      {
        id: 't7',
        emoji: '🗄️',
        title: 'ออกแบบ Schema ฐานข้อมูล Supabase และ RLS Policy',
        tag: 'Database',
        tagColor: 'bg-indigo-100 text-indigo-800',
        status: 'done',
        startDate: '3 ต.ค.',
        deadline: '9 ต.ค.',
        periodLabel: '3 ต.ค. – 9 ต.ค.',
        timeStatus: 'completed',
        timeStatusLabel: '✅ เสร็จสมบูรณ์แล้ว',
        timeProgressPercent: 100,
        assignee: 'สมชาย พัฒนา',
      },
      {
        id: 't8',
        emoji: '🔐',
        title: 'ระบบยืนยันตัวตน Login & Sign Up ด้วย Email',
        tag: 'Security',
        tagColor: 'bg-cyan-100 text-cyan-800',
        status: 'done',
        startDate: '5 ต.ค.',
        deadline: '12 ต.ค.',
        periodLabel: '5 ต.ค. – 12 ต.ค.',
        timeStatus: 'completed',
        timeStatusLabel: '✅ เสร็จสมบูรณ์แล้ว',
        timeProgressPercent: 100,
        assignee: 'วรัญญา มีสุข',
      },
    ],
    members: [
      { name: 'นที ทองดี', initials: 'นท', color: 'bg-emerald-500', assigned: 4, done: 3, pending: 1, lastActivity: 'อัปเดตสถานะงาน "ออกแบบ UI" เป็นกำลังทำ — 42 นาทีที่แล้ว' },
      { name: 'วรัญญา มีสุข', initials: 'วญ', color: 'bg-orange-400', assigned: 3, done: 2, pending: 1, lastActivity: 'เสร็จสิ้นงาน "จัดทำเอกสาร" — 2 ชั่วโมงที่แล้ว' },
      { name: 'วิภา ใจงาม', initials: 'วภ', color: 'bg-pink-500', assigned: 3, done: 1, pending: 2, lastActivity: 'รับงาน "เขียนเทสเคส" — 1 วันที่แล้ว' },
    ],
    activity: [
      { icon: '📝', text: 'สมชาย สร้างงาน "พัฒนาหน้าโปรไฟล์ผู้ใช้งาน"', time: '9 นาทีที่แล้ว' },
      { icon: '🔄', text: 'นที เปลี่ยนสถานะงาน "ออกแบบ UI" เป็น กำลังทำ', time: '42 นาทีที่แล้ว' },
      { icon: '✅', text: 'วรัญญา เสร็จสิ้นงาน "จัดทำเอกสาร Requirement"', time: '2 ชั่วโมงที่แล้ว' },
      { icon: '👋', text: 'วิภา เข้าร่วมกลุ่มและรับมอบหมายงานเทสเคส', time: '1 วันที่แล้ว' },
    ],
  },
  {
    id: 'p2',
    title: 'ปรับปรุงเว็บไซต์องค์กร',
    description: 'Redesign เว็บเก่าให้อยู่ในระบบ Cloud ปลอดภัยและทันสมัย',
    progress: 40,
    totalTasks: 6,
    tasks: [
      // To Do
      {
        id: 'p2_t1',
        emoji: '✍️',
        title: 'เขียน Content หน้าเกี่ยวกับเราและประวัติบริษัท',
        tag: 'Content',
        tagColor: 'bg-pink-100 text-pink-800',
        status: 'todo',
        startDate: '25 ต.ค.',
        deadline: '1 พ.ย.',
        periodLabel: '25 ต.ค. – 1 พ.ย.',
        timeStatus: 'normal',
        timeStatusLabel: 'เหลืออีก 14 วัน (ช่วงวางแผน)',
        timeProgressPercent: 10,
        assignee: 'รอเปิดรับ',
      },
      {
        id: 'p2_t2',
        emoji: '🔍',
        title: 'ตรวจสอบ SEO และโครงสร้าง Structured Data',
        tag: 'Marketing',
        tagColor: 'bg-amber-100 text-amber-800',
        status: 'todo',
        startDate: '28 ต.ค.',
        deadline: '5 พ.ย.',
        periodLabel: '28 ต.ค. – 5 พ.ย.',
        timeStatus: 'early',
        timeStatusLabel: 'เหลืออีก 18 วัน',
        timeProgressPercent: 0,
        assignee: 'รอเปิดรับ',
      },
      // Doing
      {
        id: 'p2_t3',
        emoji: '🎨',
        title: 'ออกแบบ Homepage ฉบับใหม่สไตล์ Clean Minimal',
        tag: 'Design',
        tagColor: 'bg-purple-100 text-purple-800',
        status: 'doing',
        startDate: '10 ต.ค.',
        deadline: '22 ต.ค.',
        periodLabel: '10 ต.ค. – 22 ต.ค.',
        timeStatus: 'urgent',
        timeStatusLabel: '⚠️ เหลืออีก 4 วัน (ช่วงส่งมอบรอบแรก)',
        timeProgressPercent: 65,
        assignee: 'นที ทองดี',
      },
      {
        id: 'p2_t4',
        emoji: '📁',
        title: 'จัดเตรียม Asset และกราฟิกประกอบเว็บ V2',
        tag: 'Media',
        tagColor: 'bg-teal-100 text-teal-800',
        status: 'doing',
        startDate: '12 ต.ค.',
        deadline: '20 ต.ค.',
        periodLabel: '12 ต.ค. – 20 ต.ค.',
        timeStatus: 'urgent',
        timeStatusLabel: '⚠️ เหลืออีก 2 วัน (ช่วงเร่งด่วน)',
        timeProgressPercent: 80,
        assignee: 'ปริชาติ สุขใส',
      },
      // Done
      {
        id: 'p2_t5',
        emoji: '☁️',
        title: 'ย้ายระบบและกำหนดค่า Domain บน Cloudflare',
        tag: 'DevOps',
        tagColor: 'bg-sky-100 text-sky-800',
        status: 'done',
        startDate: '1 ต.ค.',
        deadline: '9 ต.ค.',
        periodLabel: '1 ต.ค. – 9 ต.ค.',
        timeStatus: 'completed',
        timeStatusLabel: '✅ เสร็จตรงเวลา',
        timeProgressPercent: 100,
        assignee: 'ปริชาติ สุขใส',
      },
      {
        id: 'p2_t6',
        emoji: '📐',
        title: 'วิเคราะห์โครงสร้างเดิมและร่าง Wireframe เบื้องต้น',
        tag: 'Planning',
        tagColor: 'bg-emerald-100 text-emerald-800',
        status: 'done',
        startDate: '3 ต.ค.',
        deadline: '8 ต.ค.',
        periodLabel: '3 ต.ค. – 8 ต.ค.',
        timeStatus: 'completed',
        timeStatusLabel: '✅ เสร็จสมบูรณ์แล้ว',
        timeProgressPercent: 100,
        assignee: 'นที ทองดี',
      },
    ],
    members: [
      { name: 'นที ทองดี', initials: 'นท', color: 'bg-emerald-500', assigned: 4, done: 1, pending: 3, lastActivity: 'เริ่มงาน "ออกแบบ Homepage" — 3 ชั่วโมงที่แล้ว' },
      { name: 'ปริชาติ สุขใส', initials: 'ปช', color: 'bg-violet-500', assigned: 4, done: 2, pending: 2, lastActivity: 'อัปโหลดไฟล์ Design — เมื่อวาน' },
    ],
    activity: [
      { icon: '🔄', text: 'นที เริ่มงาน "ออกแบบ Homepage ฉบับใหม่"', time: '3 ชั่วโมงที่แล้ว' },
      { icon: '📎', text: 'ปริชาติ อัปโหลดไฟล์ Design V2', time: 'เมื่อวาน' },
      { icon: '☁️', text: 'ปริชาติ เสร็จสิ้นงาน "ย้ายระบบขึ้น Cloudflare"', time: '3 วันที่แล้ว' },
    ],
  },
];

type ProjectTab = 'tasks' | 'activity' | 'contributions';

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

        if (memberUserIds.length > 0) {
          const { data: userRows } = await supabase
            .from('users')
            .select('user_id, full_name, email')
            .in('user_id', memberUserIds);

          (userRows || []).forEach((u: any) => {
            userMap[u.user_id] = u.full_name || u.email || 'สมาชิก';
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

            return {
              id: t.task_id,
              emoji: status === 'done' ? '✅' : status === 'doing' ? '⚡' : '📋',
              title: t.title,
              tag: t.assignment_type === 'open_choice' ? 'เปิดให้เลือก' : 'มอบหมาย',
              tagColor: t.assignment_type === 'open_choice' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800',
              status,
              startDate: new Date(t.created_at).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }),
              deadline: deadlineText,
              periodLabel: `กำหนดส่ง: ${deadlineText}`,
              timeStatus: status === 'done' ? 'completed' : status === 'doing' ? 'urgent' : 'normal',
              timeStatusLabel:
                status === 'done'
                  ? '✅ เสร็จสมบูรณ์แล้ว'
                  : status === 'doing'
                  ? '⚡ กำลังดำเนินงาน'
                  : '⏳ รอเริ่มงาน / รอคนรับ',
              timeProgressPercent: status === 'done' ? 100 : status === 'doing' ? 65 : 15,
              assignee: assigneeName,
            };
          });

          const groupMembers = (memberRows || []).filter((m: any) => m.group_id === g.group_id);
          const membersList = groupMembers.map((m: any) => {
            const mName = userMap[m.user_id] || 'สมาชิก';
            const initials = mName.substring(0, 2);
            const mAssignedTasks = groupTasks.filter((t: any) => t.assigned_to === m.user_id);
            const mDone = mAssignedTasks.filter((t: any) => t.status === 'completed').length;
            const mPending = mAssignedTasks.filter((t: any) => t.status !== 'completed').length;

            return {
              name: mName,
              initials,
              color: 'bg-indigo-500',
              assigned: mAssignedTasks.length,
              done: mDone,
              pending: mPending,
              lastActivity: 'ร่วมงานในกลุ่ม',
            };
          });

          const total = kanbanTasks.length;
          const progress = projectProgress(groupTasks);

          return {
            id: g.group_id,
            title: g.group_name,
            description: g.description || 'โครงการบริหารงานกลุ่ม',
            progress,
            totalTasks: total,
            tasks: kanbanTasks,
            members: membersList,
            activity: [
              { icon: '📁', text: `สร้างกลุ่ม "${g.group_name}" สำเร็จ`, time: 'ระบบ' },
              ...kanbanTasks.slice(0, 3).map((t) => ({
                icon: t.status === 'done' ? '✅' : '📝',
                text: `งาน "${t.title}" (${t.assignee})`,
                time: t.status === 'done' ? 'เสร็จแล้ว' : 'กำลังดำเนินการ',
              })),
            ],
            raw: {
              members: groupMembers.map((m: any) => ({
                user_id: m.user_id,
                role: m.role,
                full_name: userMap[m.user_id] || null,
                email: null,
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
          <h1 className="text-[28px] font-bold text-slate-800">👑 มุมมองหัวหน้า</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            จัดการกลุ่ม มอบหมายงาน ติดตามความคืบหน้ารูปแบบบอร์ด และสรุปผลการมีส่วนร่วม
          </p>
        </div>

        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-[14px] font-semibold text-white shadow-lg shadow-indigo-200 hover:opacity-90 hover:scale-[1.02] transition-all"
        >
          <Plus size={18} />
          <span>+ สร้างกลุ่มใหม่</span>
        </Link>
      </div>

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
                      👑 คุณเป็นหัวหน้า
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

                  <div className="flex items-center justify-between text-[13px]">
                    <Link
                      href={`/dashboard/groups/${g.group_id}`}
                      className="text-indigo-600 font-semibold hover:underline"
                    >
                      เข้าสู่ห้องกลุ่ม →
                    </Link>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/groups/${g.group_id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 transition"
                      >
                        <Users size={13} />
                        เพิ่มสมาชิก
                      </Link>
                      <Link
                        href={`/dashboard/groups/${g.group_id}?tab=tasks&new=1`}
                        className="text-slate-500 hover:text-indigo-600 font-medium text-[12px]"
                      >
                        + มอบหมายงาน
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
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold text-slate-800">
            ภาพรวมโครงการที่คุณดูแล ({realProjects.length} โครงการ)
          </h2>
        </div>

        {!loading && realProjects.length === 0 && (
          <div className="gt-card p-8 text-center text-[14px] text-slate-500">
            ยังไม่มีกลุ่มที่คุณเป็นหัวหน้า กด &quot;สร้างกลุ่มใหม่&quot; เพื่อเริ่มต้น
          </div>
        )}

        {realProjects.map((proj) => {
          const currentTab = activeTabs[proj.id] || 'tasks';

          const todoTasks = proj.tasks.filter((t) => t.status === 'todo');
          const doingTasks = proj.tasks.filter((t) => t.status === 'doing');
          const doneTasks = proj.tasks.filter((t) => t.status === 'done');

          return (
            <section key={proj.id} className="gt-card p-6 space-y-6 border border-slate-100 shadow-sm">
              {/* Project Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">📁</span>
                    <h2 className="text-[22px] font-bold text-slate-800">{proj.title}</h2>
                  </div>
                  <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">{proj.description}</p>
                  <div className="mt-3 flex items-center gap-4 text-[13px] text-slate-600">
                    <span className="font-medium text-slate-700">📋 {proj.totalTasks} งานทั้งหมด</span>
                    <span className="font-medium text-slate-700">👥 {proj.members.length} สมาชิก</span>
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
              <div className="flex items-center justify-between border-b border-slate-200">
                <div className="flex gap-6">
                  <button
                    type="button"
                    onClick={() => handleTabChange(proj.id, 'tasks')}
                    className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
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
                    className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
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
                    className={`-mb-px pb-3 text-[14px] transition-all flex items-center gap-2 cursor-pointer ${
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
                      {proj.members.length} สมาชิก
                    </span>
                  </button>
                </div>

                <Link
                  href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                  className="hidden sm:inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 -mb-2"
                >
                  <Plus size={15} />
                  <span>สร้างงานใหม่ในโครงการ</span>
                </Link>
              </div>

              {/* ===== แท็บที่ 1: งานทั้งหมดในโครงการ (Notion Board View สไตล์ภาพที่ 1) ===== */}
              {currentTab === 'tasks' && (
                <div className="space-y-4">
                  {/* แถบหัวบอร์ดแบบ Notion */}
                  <div className="flex items-center justify-between bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
                        <LayoutGrid size={15} className="text-slate-500" />
                        Board View
                      </span>
                      <span className="text-[12px] text-slate-400">| จัดการระยะเวลาและสถานะงานแต่ละช่วง</span>
                    </div>
                    <Link
                      href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold hover:bg-indigo-700 shadow-sm transition"
                    >
                      <Plus size={14} />
                      <span>New</span>
                    </Link>
                  </div>

                  {/* คอลัมน์ Kanban บอร์ด สไตล์ Notion */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* คอลัมน์ 1: To Do */}
                    <div className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200/70 flex flex-col min-h-[350px]">
                      {/* Column Header */}
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-[12px] font-bold bg-amber-100 text-amber-800">
                            To Do
                          </span>
                          <span className="text-[12px] text-slate-400 font-medium">{todoTasks.length}</span>
                        </div>
                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="h-6 w-6 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
                          title="เพิ่มงานใหม่"
                        >
                          <Plus size={15} />
                        </Link>
                      </div>

                      {/* Cards List */}
                      <div className="space-y-3 flex-1">
                        {todoTasks.map((t) => (
                          <div
                            key={t.id}
                            className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-slate-300 transition-all duration-200 space-y-2.5"
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-lg leading-tight flex-shrink-0">{t.emoji}</span>
                              <h4 className="text-[13px] font-semibold text-slate-800 leading-snug">{t.title}</h4>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${t.tagColor}`}>
                                {t.tag}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                👤 {t.assignee}
                              </span>
                            </div>

                            {/* กำหนดระยะเวลางานในแต่ละช่วง (Period & Timeline) */}
                            <div className="pt-2 border-t border-slate-100 space-y-1.5 text-[11px]">
                              <div className="flex items-center justify-between text-slate-500">
                                <span className="flex items-center gap-1 font-medium">
                                  <Calendar size={12} className="text-indigo-500" />
                                  {t.periodLabel}
                                </span>
                                <span className="text-slate-400 font-mono text-[10px]">
                                  {t.timeStatusLabel}
                                </span>
                              </div>
                              {/* แถบ Timeline Mini-bar แสดงความคืบหน้าของเวลา */}
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-amber-400"
                                  style={{ width: `${t.timeProgressPercent}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="w-full py-2 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-400 hover:text-indigo-600 text-[12px] font-medium flex items-center justify-center gap-1 transition"
                        >
                          <Plus size={14} />
                          <span>+ New</span>
                        </Link>
                      </div>
                    </div>

                    {/* คอลัมน์ 2: Doing */}
                    <div className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200/70 flex flex-col min-h-[350px]">
                      {/* Column Header */}
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-[12px] font-bold bg-blue-100 text-blue-800">
                            Doing
                          </span>
                          <span className="text-[12px] text-slate-400 font-medium">{doingTasks.length}</span>
                        </div>
                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="h-6 w-6 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
                          title="เพิ่มงานใหม่"
                        >
                          <Plus size={15} />
                        </Link>
                      </div>

                      {/* Cards List */}
                      <div className="space-y-3 flex-1">
                        {doingTasks.map((t) => (
                          <div
                            key={t.id}
                            className="bg-white rounded-xl p-3.5 border border-blue-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-blue-300 transition-all duration-200 space-y-2.5"
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-lg leading-tight flex-shrink-0">{t.emoji}</span>
                              <h4 className="text-[13px] font-semibold text-slate-800 leading-snug">{t.title}</h4>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${t.tagColor}`}>
                                {t.tag}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                                👤 {t.assignee}
                              </span>
                            </div>

                            {/* กำหนดระยะเวลางานในแต่ละช่วง (Period & Timeline) */}
                            <div className="pt-2 border-t border-slate-100 space-y-1.5 text-[11px]">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1 font-medium text-slate-600">
                                  <Clock size={12} className="text-blue-500" />
                                  {t.periodLabel}
                                </span>
                                <span className="font-semibold text-[10px] text-rose-600">
                                  {t.timeStatusLabel}
                                </span>
                              </div>
                              {/* แถบ Timeline Mini-bar แสดงความคืบหน้าของเวลา */}
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-rose-500"
                                  style={{ width: `${t.timeProgressPercent}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="w-full py-2 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-400 hover:text-indigo-600 text-[12px] font-medium flex items-center justify-center gap-1 transition"
                        >
                          <Plus size={14} />
                          <span>+ New</span>
                        </Link>
                      </div>
                    </div>

                    {/* คอลัมน์ 3: Done */}
                    <div className="bg-slate-50/80 rounded-2xl p-3 border border-slate-200/70 flex flex-col min-h-[350px]">
                      {/* Column Header */}
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-[12px] font-bold bg-emerald-100 text-emerald-800">
                            Done
                          </span>
                          <span className="text-[12px] text-slate-400 font-medium">{doneTasks.length}</span>
                        </div>
                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="h-6 w-6 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition"
                          title="เพิ่มงานใหม่"
                        >
                          <Plus size={15} />
                        </Link>
                      </div>

                      {/* Cards List */}
                      <div className="space-y-3 flex-1">
                        {doneTasks.map((t) => (
                          <div
                            key={t.id}
                            className="bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md hover:border-emerald-300 transition-all duration-200 space-y-2.5 opacity-90 hover:opacity-100"
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-lg leading-tight flex-shrink-0">{t.emoji}</span>
                              <h4 className="text-[13px] font-semibold text-slate-700 line-through leading-snug">{t.title}</h4>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${t.tagColor}`}>
                                {t.tag}
                              </span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                                👤 {t.assignee}
                              </span>
                            </div>

                            {/* กำหนดระยะเวลางานในแต่ละช่วง (Period & Timeline) */}
                            <div className="pt-2 border-t border-slate-100 space-y-1.5 text-[11px]">
                              <div className="flex items-center justify-between text-slate-500">
                                <span className="flex items-center gap-1 font-medium">
                                  <CheckCircle2 size={12} className="text-emerald-500" />
                                  {t.periodLabel}
                                </span>
                                <span className="text-emerald-600 font-semibold text-[10px]">
                                  {t.timeStatusLabel}
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: '100%' }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}

                        <Link
                          href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                          className="w-full py-2 rounded-xl border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-slate-400 hover:text-indigo-600 text-[12px] font-medium flex items-center justify-center gap-1 transition"
                        >
                          <Plus size={14} />
                          <span>+ New</span>
                        </Link>
                      </div>
                    </div>
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

                  {currentUserId && proj.raw && (
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
                    {proj.raw && (
                      <div className="lg:col-span-2">
                        <ParticipationSummary
                          groupId={proj.id}
                          members={proj.raw.members}
                          tasks={proj.raw.tasks}
                          taskResponses={proj.raw.responses}
                        />
                      </div>
                    )}

                    {/* เครื่องมือมอบหมายงานและสรุปยอด */}
                    <div className="space-y-4">
                      <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 space-y-3">
                        <h4 className="text-[13px] font-bold text-slate-700">⚡ จัดการและมอบหมายงาน</h4>
                        <div className="flex flex-col gap-2">
                          <Link
                            href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                            className="w-full text-center rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2.5 text-[12px] font-semibold text-white hover:opacity-90 transition block shadow-sm"
                          >
                            + สร้างงานใหม่
                          </Link>
                          <Link
                            href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                            className="w-full text-center rounded-xl border border-indigo-200 bg-white px-4 py-2 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50 transition block"
                          >
                            📤 มอบหมายงานให้สมาชิก
                          </Link>
                          <Link
                            href={`/dashboard/groups/${proj.id}?tab=tasks&new=1`}
                            className="w-full text-center rounded-xl border border-purple-200 bg-white px-4 py-2 text-[12px] font-semibold text-purple-700 hover:bg-purple-50 transition block"
                          >
                            📋 สร้างงานว่าง (สมาชิกเลือกเอง)
                          </Link>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-4 text-white space-y-2">
                        <h4 className="text-[13px] font-bold">💡 คำแนะนำสำหรับหัวหน้า</h4>
                        <p className="text-[11px] text-indigo-100 leading-relaxed">
                          ควรกำหนดช่วงเวลา (Start date & Deadline) ให้ชัดเจนในแต่ละขั้นตอน เพื่อช่วยให้สมาชิกลำดับความสำคัญของงานได้ตรงตามไทม์ไลน์
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
    </div>
  );
}
