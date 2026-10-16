import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

export const metadata = {
  title: 'นโยบายความเป็นส่วนตัว | GroupTask',
}

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'ข้อมูลที่เราเก็บ',
    items: [
      'ชื่อที่แสดงและอีเมลที่ใช้สมัครหรือเข้าสู่ระบบ',
      'เมื่อเข้าสู่ระบบด้วย Google เราได้รับเฉพาะชื่อ อีเมล และรูปโปรไฟล์ ไม่เข้าถึงข้อมูลอื่นในบัญชี Google',
      'รูปโปรไฟล์ที่คุณอัปโหลดเอง',
      'ข้อมูลการทำงานในกลุ่ม ได้แก่ กลุ่ม งาน ความเห็น ลิงก์ผลงาน ฟีดแบค และแบบประเมินเพื่อน',
      'ประวัติกิจกรรม (activity log) ของการกระทำในกลุ่ม พร้อมเวลาที่เกิดขึ้น',
    ],
  },
  {
    title: 'เราใช้ข้อมูลเพื่ออะไร',
    items: [
      'ให้บริการระบบบริหารจัดการงานกลุ่ม เช่น มอบหมายงาน ติดตามสถานะ และแจ้งสิ่งที่คุณพลาดไป',
      'สรุปการมีส่วนร่วมของสมาชิกแต่ละคนให้สมาชิกในกลุ่มเห็นอย่างโปร่งใส',
      'เราไม่ขาย ไม่แลกเปลี่ยน และไม่ส่งต่อข้อมูลของคุณให้บุคคลภายนอก',
    ],
  },
  {
    title: 'ใครเห็นข้อมูลของคุณ',
    items: [
      'สมาชิกในกลุ่มเดียวกันเห็นชื่อ รูปโปรไฟล์ งาน ความเห็น และประวัติกิจกรรมของกลุ่มนั้น',
      'คะแนนประเมินเพื่อนไม่เปิดเผยชื่อผู้ประเมิน หัวหน้ากลุ่มเห็นเฉพาะผลรวมหลังปิดรอบประเมิน',
      'ฟีดแบคหลังงานเสร็จอ่านได้เฉพาะผู้ส่งและหัวหน้ากลุ่ม',
      'คนที่ไม่ได้อยู่ในกลุ่มมองไม่เห็นข้อมูลของกลุ่ม',
    ],
  },
  {
    title: 'การจัดเก็บและการลบ',
    items: [
      'ข้อมูลจัดเก็บบนบริการฐานข้อมูล Supabase และเข้าถึงได้ตามสิทธิ์ที่ระบบกำหนดเท่านั้น',
      'ประวัติกิจกรรมแก้ไขหรือลบไม่ได้ เพื่อให้ตรวจสอบย้อนหลังได้ จึงยังคงอยู่แม้คุณออกจากกลุ่มแล้ว',
      'คุณแก้ไขชื่อที่แสดงและรูปโปรไฟล์ได้เองที่หน้าโปรไฟล์ หากต้องการลบบัญชี กรุณาติดต่อผู้พัฒนาระบบ',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#F8F9FE] px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition"
        >
          <ArrowLeft size={16} />
          กลับ
        </Link>

        <div className="gt-card mt-4 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <ShieldCheck size={28} className="text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-900">นโยบายความเป็นส่วนตัว</h1>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            GroupTask ระบบบริหารจัดการงานกลุ่ม · ปรับปรุงล่าสุด 16 ตุลาคม 2569
          </p>

          {SECTIONS.map((s) => (
            <section key={s.title} className="mt-6">
              <h2 className="text-lg font-semibold text-slate-900">{s.title}</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
