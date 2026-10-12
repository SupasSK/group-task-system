"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase";
import { Users, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function JoinProjectPage() {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const router = useRouter();
  const supabase = createClient();

  const updateDigit = (index: number, value: string) => {
    // รองรับตัวเลขและตัวอักษรภาษาอังกฤษ
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean) {
      const copy = [...digits];
      copy[index] = "";
      setDigits(copy);
      return;
    }
    const nextChar = clean.slice(-1);
    const copy = [...digits];
    copy[index] = nextChar;
    setDigits(copy);
    if (index < 5) inputs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pasted) {
      const chars = pasted.slice(0, 6).split("");
      const newDigits = [...digits];
      chars.forEach((c, idx) => {
        newDigits[idx] = c;
      });
      setDigits(newDigits);
      const nextFocus = Math.min(chars.length, 5);
      inputs.current[nextFocus]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("").toUpperCase();
    if (code.length !== 6) {
      alert("กรุณากรอกรหัสกลุ่ม 6 ตัวอักษรให้ครบถ้วน");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("กรุณาเข้าสู่ระบบก่อนเข้าร่วมกลุ่ม");
        router.push("/login");
        return;
      }

      const { data: rows, error: rpcError } = await supabase.rpc(
        "join_group_by_code",
        { p_code: code }
      );

      if (rpcError) {
        alert("เข้าร่วมกลุ่มไม่สำเร็จ: " + rpcError.message);
        setLoading(false);
        return;
      }

      if (!rows || rows.length === 0) {
        alert("ไม่พบกลุ่มที่ตรงกับรหัสนี้ หรือรหัสไม่ถูกต้อง");
        setLoading(false);
        return;
      }

      const result = rows[0] as {
        joined_group_id: string;
        joined_group_name: string;
        newly_joined: boolean;
      };

      if (result.newly_joined) {
        alert(`🎉 เข้าร่วมกลุ่ม "${result.joined_group_name}" สำเร็จแล้ว!`);
      } else {
        alert(`คุณเป็นสมาชิกของกลุ่ม "${result.joined_group_name}" อยู่แล้ว`);
      }

      router.push(`/dashboard/groups/${result.joined_group_id}`);
    } catch (err: any) {
      alert("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl pt-4">
      <div className="mb-6">
        <Link
          href="/dashboard/member"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition"
        >
          <ArrowLeft size={16} />
          กลับไปหน้าสมาชิก
        </Link>
      </div>

      <div className="text-center mb-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-100">
          <Users size={28} />
        </div>
        <h1 className="text-[28px] font-bold text-slate-800">เข้าร่วมกลุ่มด้วยรหัส</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-slate-400">
          กรอกรหัสโครงการ 6 หลัก (ตัวอักษรหรือตัวเลข) ที่ได้รับจากหัวหน้ากลุ่มเพื่อเข้าร่วมทีม
        </p>
      </div>

      <form onSubmit={handleSubmit} className="gt-card px-8 py-10 text-center rounded-3xl">
        <div className="my-8 flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              value={digit}
              onChange={(e) => updateDigit(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              maxLength={1}
              autoFocus={index === 0}
              className={`h-14 w-12 sm:w-14 rounded-2xl bg-slate-50 text-center text-[22px] font-bold text-slate-800 shadow-sm outline-none transition-all ${
                digit
                  ? "border-2 border-indigo-500 bg-white shadow-indigo-100"
                  : "border border-slate-200 focus:border-indigo-400 focus:bg-white"
              }`}
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="gt-btn w-full max-w-md mx-auto rounded-2xl py-3.5 text-[15px] disabled:opacity-60"
        >
          {loading ? "กำลังตรวจสอบและเข้าร่วม..." : "เข้าร่วมกลุ่ม"}
        </button>
      </form>
    </div>
  );
}
