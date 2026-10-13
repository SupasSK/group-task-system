import { redirect } from "next/navigation";

// ประวัติกิจกรรมอยู่ในแท็บ "ภาพรวม" ของหน้ากลุ่ม
export default function ActivityPage() {
  redirect("/dashboard");
}
