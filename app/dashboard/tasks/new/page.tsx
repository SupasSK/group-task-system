import { redirect } from "next/navigation";

// การสร้างงานทำในแท็บ "งาน" ของหน้ากลุ่ม หน้านี้จึงพาไปหน้าหัวหน้าเพื่อเลือกกลุ่ม
export default function NewTaskPage() {
  redirect("/dashboard/leader");
}
