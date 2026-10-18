import { redirect } from "next/navigation";

// หน้าสมาชิกเดิมย้ายไปเป็นหน้า "งานของฉัน" แล้ว
export default function MemberPage() {
  redirect("/dashboard/my-tasks");
}
