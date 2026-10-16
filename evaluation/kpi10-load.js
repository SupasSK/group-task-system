// KPI-10 ภาระพร้อมกัน (k6 v2.3.0): ผู้ใช้เสมือน 40 คน ทำ journey ตายตัวซ้ำ ๆ
// รายละเอียดที่กำหนดก่อนรัน (เพิ่มเติมจากเกณฑ์ข้อ 3):
// - ล็อกอินครั้งเดียวต่อบัญชีใน setup() (11 บัญชีของกลุ่ม KPI-10) ผู้ใช้เสมือนแต่ละคนใช้ token ของบัญชีที่ (VU-1) % 11
//   บัญชีที่ล็อกอินไม่สำเร็จจะไม่ล็อกอินซ้ำ คำขอของผู้ใช้เสมือนที่ใช้บัญชีนั้นจะล้มและถูกนับ (แก้ข้อบกพร่องที่ Buzzly รายงาน)
// - journey หนึ่งรอบ = คำขอที่หน้าเว็บส่งเมื่อเปิด dashboard แล้วเปิดหน้ากลุ่ม: โหลดหน้าเว็บ (Vercel) แล้วเรียก Supabase 9 คำขอ
// - พัก 1 วินาทีระหว่างรอบ (เวลาอ่านของผู้ใช้)
// - ค่าที่วัด: http_req_duration p(95) และ http_req_failed ของทุกคำขอ (รวม setup)
// วิธีรัน: k6 run -e PASSWORD=... -e SUPABASE_URL=... -e ANON_KEY=... [-e CONTROL=1] --summary-export out.json kpi10-load.js
import http from 'k6/http'
import { check, sleep } from 'k6'

const fx = JSON.parse(open('./kpi10-fixture.json'))
const BASE = __ENV.BASE_URL || 'https://group-task-system.vercel.app'
const SB = __ENV.SUPABASE_URL
const ANON = __ENV.ANON_KEY

export const options = {
  stages: __ENV.PILOT
    ? [{ duration: '30s', target: 2 }]
    : __ENV.CONTROL
    ? [{ duration: '2m', target: 1 }]
    : [{ duration: '1m', target: 40 }, { duration: '3m', target: 40 }, { duration: '1m', target: 0 }],
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
  thresholds: { http_req_duration: ['p(95)<2000'], http_req_failed: ['rate<0.01'] },
  setupTimeout: '2m',
}

export function setup() {
  return fx.accounts.map((email) => {
    const r = http.post(`${SB}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password: __ENV.PASSWORD }), {
      headers: { apikey: ANON, 'Content-Type': 'application/json' }, tags: { step: 'login' },
    })
    return r.status === 200 ? { token: r.json('access_token'), id: r.json('user.id') } : { token: null, id: null }
  })
}

export default function (accounts) {
  const a = accounts[(__VU - 1) % accounts.length]
  const params = (step) => ({ headers: { apikey: ANON, Authorization: `Bearer ${a.token}` }, tags: { step } })
  const rest = (step, path) => {
    const r = http.get(`${SB}/rest/v1/${path}`, params(step))
    check(r, { [`${step} 200`]: (x) => x.status === 200 })
  }
  const g = fx.group_id
  const shell = http.get(`${BASE}/login`, { tags: { step: 'shell' } })
  check(shell, { 'shell 200': (x) => x.status === 200 })
  rest('my_groups', `group_members?select=role,groups(group_id,group_name,description,work_mode,join_code,archived_at)&user_id=eq.${a.id}`)
  rest('group', `groups?select=group_id,group_name,description,work_mode,join_code,created_by,pending_leader_id,archived_at&group_id=eq.${g}`)
  rest('members', `group_members?select=user_id,role,joined_at&group_id=eq.${g}`)
  rest('users', `users?select=user_id,full_name,email,avatar_url,custom_avatar_url&user_id=eq.${a.id}`)
  rest('tasks', `tasks?select=*&group_id=eq.${g}&order=created_at.desc`)
  rest('collaborators', `task_collaborators?select=task_id,user_id,status,note&group_id=eq.${g}`)
  rest('visits', `group_visits?select=last_seen_at&group_id=eq.${g}&user_id=eq.${a.id}`)
  rest('logs', `activity_logs?select=log_id,actor_id,action_type,entity_type,entity_id,payload,created_at&group_id=eq.${g}&order=created_at.desc&limit=200`)
  rest('integrity', `integrity_checks?select=is_valid,broken_at_seq,checked_at&group_id=eq.${g}&order=checked_at.desc&limit=1`)
  sleep(1)
}
