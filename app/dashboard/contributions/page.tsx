import { redirect } from "next/navigation";

// คะแนนการมีส่วนร่วมอยู่ในแท็บ "สรุป" ของหน้ากลุ่ม
export default function ContributionsPage() {
  redirect("/dashboard");
}
