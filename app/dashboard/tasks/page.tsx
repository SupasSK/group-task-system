import { redirect } from "next/navigation";

// รายการงานดูได้ในแท็บ "งาน" ของหน้ากลุ่ม และบอร์ดในหน้าหัวหน้า
export default function TasksPage() {
  redirect("/dashboard/leader");
}
