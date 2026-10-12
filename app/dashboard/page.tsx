'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase';
import { PROJECTS } from '@/lib/mock-data';
import DashboardCalendar from '@/components/dashboard/DashboardCalendar';
import IconNavigationToolbar from '@/components/dashboard/IconNavigationToolbar';
import { Plus, UserPlus, Users, Sparkles, FolderKanban } from 'lucide-react';

const STATS = [
  { label: 'โครงการทั้งหมด', value: 6, color: 'from-indigo-500 to-purple-500', emoji: '📁' },
  { label: 'งานทั้งหมด', value: 24, color: 'from-purple-500 to-pink-500', emoji: '📋' },
  { label: 'กำลังดำเนินการ', value: 9, color: 'from-blue-500 to-cyan-400', emoji: '⚡' },
  { label: 'เสร็จสิ้น', value: 12, color: 'from-emerald-500 to-teal-400', emoji: '✅' },
  { label: 'เลยกำหนด', value: 3, color: 'from-rose-500 to-pink-400', emoji: '⚠️' },
];

const RECENT_ACTIVITY = [
  { icon: '📝', text: 'สมชาย สร้างงาน "พัฒนาหน้าโปรไฟล์ผู้ใช้งาน"', project: 'แอปเดลิเวอรี่', time: '9 นาทีที่แล้ว' },
  { icon: '🔄', text: 'นที เปลี่ยนสถานะงาน "ออกแบบ UI" เป็น กำลังทำ', project: 'ปรับปรุงเว็บไซต์', time: '42 นาทีที่แล้ว' },
  { icon: '✅', text: 'วรัญญา เสร็จสิ้นงาน "จัดทำเอกสาร"', project: 'ระบบ ERP', time: '2 ชั่วโมงที่แล้ว' },
  { icon: '👋', text: 'ปริชาติ เข้าร่วมโครงการแคมเปญ Q4', project: 'แคมเปญ Q4', time: '1 วันที่แล้ว' },
];

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
            join_code
          )
        `)
        .eq('user_id', user.id);

      if (!error && memberGroups) {
        const groups: SupabaseGroup[] = memberGroups
          .filter((item: any) => item.groups)
          .map((item: any) => ({
            group_id: item.groups.group_id,
            group_name: item.groups.group_name,
            description: item.groups.description || '',
            work_mode: item.groups.work_mode,
            join_code: item.groups.join_code,
            role: item.role,
          }));
        setUserGroups(groups);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGroups(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ===== แถบเครื่องมือนำทางแนวนอนสไตล์ไอคอน (Canva-inspired Toolbar) ===== */}
      <IconNavigationToolbar />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800">🏠 ภาพรวมทั้งหมด</h1>
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
      <DashboardCalendar />

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {STATS.map((s) => (
          <div key={s.label} className="gt-card p-5 flex flex-col gap-1">
            <span className="text-2xl">{s.emoji}</span>
            <span className={`text-[28px] font-bold bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>
              {s.label === 'โครงการทั้งหมด' && userGroups.length > 0
                ? userGroups.length + PROJECTS.length
                : s.value}
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
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                      g.role === 'leader'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {g.role === 'leader' ? '👑 หัวหน้ากลุ่ม' : '👤 สมาชิก'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      รหัส: <strong className="text-indigo-600 tracking-wider">{g.join_code}</strong>
                    </span>
                  </div>

                  <h3 className="text-[16px] font-bold text-slate-800">{g.group_name}</h3>
                  <p className="mt-1 text-[12px] text-slate-500 line-clamp-2">
                    {g.description || 'ไม่มีคำอธิบายโครงการ'}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
                  <span className="text-slate-400">
                    {g.work_mode === 'leader_all' && 'หัวหน้าคุม'}
                    {g.work_mode === 'member_choose' && 'สมาชิกเลือก'}
                    {g.work_mode === 'mixed' && 'แบบผสม'}
                  </span>
                  <Link
                    href={`/dashboard/groups/${g.group_id}`}
                    className="text-indigo-600 font-semibold hover:underline"
                  >
                    เปิดดูโครงการ →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects ทั่วไป */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-slate-800 flex items-center gap-2">
            <FolderKanban size={18} className="text-indigo-600" />
            โครงการทั้งหมด
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((p) => (
            <div key={p.id} className="gt-card p-5 flex flex-col gap-3">
              <div>
                <h3 className="text-[15px] font-bold text-slate-800">{p.title}</h3>
                <p className="mt-1 text-[12px] text-slate-500 line-clamp-2">{p.description}</p>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">ความคืบหน้า</span>
                  <span className="font-semibold text-indigo-600">{p.progress}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                    style={{ width: `${p.progress}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-[12px] text-slate-500">
                <span>👥 {p.members} สมาชิก</span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${
                  p.progress === 100 ? 'bg-emerald-100 text-emerald-700' :
                  p.progress >= 70 ? 'bg-indigo-100 text-indigo-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {p.progress === 100 ? 'เสร็จสิ้น' : p.progress >= 70 ? 'ใกล้เสร็จ' : 'กำลังทำ'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* (ปฏิทินย้ายขึ้นไปบนสุดแล้ว) */}

      {/* Recent Activity */}
      <section className="gt-card p-6">
        <h2 className="mb-4 text-[16px] font-bold text-slate-800">🕐 กิจกรรมล่าสุด</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RECENT_ACTIVITY.map((a) => (
            <div key={a.text} className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
              <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm">
                {a.icon}
              </span>
              <div>
                <p className="text-[12px] text-slate-700 leading-snug">{a.text}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{a.project}</span>
                  <span className="text-[10px] text-slate-400">{a.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
