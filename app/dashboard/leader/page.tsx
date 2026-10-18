import { redirect } from "next/navigation";

// ทุกอย่างของหน้าหัวหน้าเดิม (รหัสเข้าร่วม, บอร์ดงาน, ประวัติกิจกรรม, ผลการมีส่วนร่วม) อยู่ในหน้ากลุ่มแล้ว
export default function LeaderPage() {
  redirect("/dashboard/groups");
}
