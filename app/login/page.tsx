'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Hand,
  Sparkles,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/utils/supabase'

// Regex ตรวจสอบรูปแบบอีเมลมาตรฐาน
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ฟังก์ชันแปลงข้อความ Error จาก Supabase เป็นภาษาไทยที่เข้าใจง่าย
function getThaiAuthErrorMessage(error: any): string {
  if (!error) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  const msg = (error.message || '').toLowerCase()
  const code = (error.code || '').toLowerCase()

  if (
    code === 'email_address_invalid' ||
    msg.includes('is invalid') ||
    msg.includes('invalid email') ||
    msg.includes('email address')
  ) {
    return 'รูปแบบอีเมลไม่ถูกต้อง หรืออีเมลนี้ไม่สามารถใช้งานได้ กรุณาตรวจสอบอีเมลของคุณอีกครั้ง'
  }
  if (
    code === 'over_email_send_rate_limit' ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return 'ส่งคำขออีเมลบ่อยเกินไปชั่วคราว (Rate limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'
  }
  if (
    code === 'user_already_exists' ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  ) {
    return 'อีเมลนี้ถูกลงทะเบียนไว้แล้ว กรุณาเข้าสู่ระบบ'
  }
  if (msg.includes('invalid login credentials')) {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
  }
  if (msg.includes('email not confirmed')) {
    return 'อีเมลนี้ยังไม่ได้ยืนยันตัวตน กรุณาตรวจสอบกล่องจดหมายของคุณ หรือกดลิงก์ยืนยัน'
  }
  if (msg.includes('password') && (msg.includes('6 characters') || msg.includes('short') || msg.includes('least'))) {
    return 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร'
  }
  if (msg.includes('signup disabled') || code === 'signup_disabled') {
    return 'ระบบปิดรับการลงทะเบียนชั่วคราว'
  }
  if (msg.includes('not enabled') || msg.includes('provider')) {
    return 'ยังไม่ได้เปิดใช้งาน Google Login ใน Supabase Dashboard (Authentication > Providers > Google)'
  }

  return error.message || 'เกิดข้อผิดพลาดในการทำรายการ'
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  // State
  const [isLogin, setIsLogin] = useState(true)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMessage, setForgotMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // เช็คว่าผู้ใช้ล็อกอินอยู่แล้วหรือไม่ ถ้าล็อกอินแล้วให้เด้งไป /dashboard อัตโนมัติทันที
  useEffect(() => {
    let isMounted = true

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user && isMounted) {
        window.location.href = '/dashboard'
      }
    }
    checkSession()

    // ดักฟังการเปลี่ยนแปลงสถานะการเข้าสู่ระบบแบบ Realtime
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        window.location.href = '/dashboard'
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  // ซิงค์ข้อมูลผู้ใช้เข้าตาราง public.users ใน Supabase
  const syncUserProfile = async (userId: string, userEmail: string, name?: string) => {
    try {
      await (supabase.from('users') as any).upsert(
        {
          user_id: userId,
          email: userEmail,
          full_name: name || userEmail.split('@')[0],
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
    } catch (err) {
      console.warn('Sync profile note:', err)
    }
  }

  // เข้าสู่ระบบด้วยอีเมล & รหัสผ่าน
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const cleanEmail = email.trim()

    // 1. ตรวจสอบรูปแบบอีเมลด้วย regex มาตรฐาน
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setMessage({
        type: 'error',
        text: 'รูปแบบอีเมลไม่ถูกต้อง กรุณาระบุในรูปแบบ name@example.com',
      })
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })

      if (error) {
        setMessage({ type: 'error', text: getThaiAuthErrorMessage(error) })
        setLoading(false)
        return
      }

      if (data?.user) {
        await syncUserProfile(data.user.id, data.user.email || cleanEmail)
        setMessage({ type: 'success', text: 'เข้าสู่ระบบสำเร็จ กำลังนำคุณไปยังแดชบอร์ด...' })
        // นำทางไปยัง Dashboard ทันที
        window.location.href = '/dashboard'
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: getThaiAuthErrorMessage(err) })
      setLoading(false)
    }
  }

  // สมัครสมาชิกใหม่ด้วยอีเมล & รหัสผ่าน
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const cleanEmail = email.trim()
    const cleanFullName = fullName.trim()

    // 1. ตรวจสอบรูปแบบอีเมลด้วย regex มาตรฐาน
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setMessage({
        type: 'error',
        text: 'รูปแบบอีเมลไม่ถูกต้อง กรุณาระบุในรูปแบบ name@example.com',
      })
      setLoading(false)
      return
    }

    // 2. ตรวจสอบความยาวรหัสผ่าน
    if (password.length < 6) {
      setMessage({ type: 'error', text: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' })
      setLoading(false)
      return
    }

    // 3. ตรวจสอบว่ารหัสผ่านตรงกัน
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง' })
      setLoading(false)
      return
    }

    try {
      const redirectUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?next=/dashboard`

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanFullName || cleanEmail.split('@')[0],
          },
          emailRedirectTo: redirectUrl,
        },
      })

      if (error) {
        setMessage({ type: 'error', text: getThaiAuthErrorMessage(error) })
        setLoading(false)
        return
      }

      if (data?.user) {
        await syncUserProfile(data.user.id, data.user.email || cleanEmail, cleanFullName)

        if (data.session) {
          setMessage({
            type: 'success',
            text: 'สมัครสมาชิกสำเร็จ! กำลังนำคุณไปยังแดชบอร์ด...',
          })
          window.location.href = '/dashboard'
        } else {
          // พยายามล็อกอินเข้าใช้งานทันที เผื่อกรณีไม่ต้องยืนยันอีเมล
          const { data: loginData } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          })

          if (loginData?.session) {
            setMessage({
              type: 'success',
              text: 'สมัครสมาชิกสำเร็จ! กำลังนำคุณไปยังแดชบอร์ด...',
            })
            window.location.href = '/dashboard'
          } else {
            setMessage({
              type: 'success',
              text: 'สมัครสมาชิกสำเร็จ! ระบบต้องการยืนยันตัวตน กรุณาตรวจสอบกล่องจดหมายของคุณ',
            })
            setIsLogin(true)
            setLoading(false)
          }
        }
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: getThaiAuthErrorMessage(err) })
      setLoading(false)
    }
  }

  // เข้าสู่ระบบด้วย Google OAuth
  const handleGoogleLogin = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const redirectUrl = `${window.location.origin}/auth/callback?next=/dashboard`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      })

      if (error) {
        setMessage({ type: 'error', text: getThaiAuthErrorMessage(error) })
        setLoading(false)
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: getThaiAuthErrorMessage(err) })
      setLoading(false)
    }
  }

  // ขอรีเซ็ตรหัสผ่านทางอีเมล
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotLoading(true)
    setForgotMessage(null)

    const cleanForgotEmail = forgotEmail.trim()

    if (!EMAIL_REGEX.test(cleanForgotEmail)) {
      setForgotMessage({
        type: 'error',
        text: 'รูปแบบอีเมลไม่ถูกต้อง กรุณาระบุในรูปแบบ name@example.com',
      })
      setForgotLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanForgotEmail, {
        redirectTo: `${window.location.origin}/login?reset=true`,
      })

      if (error) {
        setForgotMessage({ type: 'error', text: getThaiAuthErrorMessage(error) })
      } else {
        setForgotMessage({
          type: 'success',
          text: 'ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณเรียบร้อยแล้ว กรุณาตรวจสอบกล่องจดหมาย',
        })
      }
    } catch (err: any) {
      setForgotMessage({ type: 'error', text: getThaiAuthErrorMessage(err) })
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F8F9FE] text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* ======================================================== */}
      {/* ฝั่งซ้าย — Branding & Live Interactive Preview (ตรงตามภาพ) */}
      {/* ======================================================== */}
      <div className="relative w-full lg:w-[48%] xl:w-[50%] lg:min-h-screen bg-[linear-gradient(135deg,#4F46E5_0%,#6366F1_25%,#7C3AED_55%,#C026D3_85%,#E11D48_100%)] p-8 sm:p-12 lg:p-16 flex flex-col justify-between overflow-hidden">
        {/* Decorative soft glow background orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[380px] h-[380px] rounded-full bg-white/10 blur-[80px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[420px] h-[420px] rounded-full bg-pink-500/20 blur-[90px] pointer-events-none" />

        {/* Top: Logo & Brand */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-[0_4px_16px_rgba(0,0,0,0.1)]">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">GroupTask</span>
        </div>

        {/* Middle: Hero Content & Mini Kanban Board Card */}
        <div className="relative z-10 my-8 lg:my-0 max-w-xl">
          {/* Badge */}
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-white/95 text-xs sm:text-sm font-medium border border-white/20 mb-5 shadow-sm">
            พื้นที่ของทีมที่ทำงานเป็นหนึ่งเดียว
          </div>

          {/* Heading */}
          <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-white leading-[1.22] tracking-tight mb-4 drop-shadow-sm">
            เปลี่ยนทุกไอเดียให้เป็นงานที่
            <br />
            สำเร็จร่วมกัน
          </h1>

          {/* Subtitle */}
          <p className="text-white/85 text-sm sm:text-base leading-relaxed mb-8 font-light max-w-lg">
            วางแผน แบ่งงาน และติดตามความคืบหน้าของทีมได้ในที่เดียว
            <br />
            เพื่อให้ทุกคนเห็นเป้าหมายเดียวกันอย่างชัดเจน
          </p>

          {/* Mini Kanban Board Mockup Card (ตามแบบภาพ) */}
          <div className="hidden lg:block bg-white rounded-[26px] p-4 sm:p-5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] border border-white/40 max-w-[490px] w-full text-slate-800 transition-transform duration-300 hover:scale-[1.01]">
            <div className="flex flex-col sm:flex-row gap-3.5">
              {/* Mini Sidebar */}
              <div className="sm:w-[130px] shrink-0 border-b sm:border-b-0 sm:border-r border-slate-100 pb-3 sm:pb-0 sm:pr-3">
                <p className="text-[12px] font-bold text-slate-800 mb-2.5">โปรเจกต์ทีม</p>
                <div className="flex sm:flex-col gap-1.5">
                  {/* Item 1 - Active */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-slate-100 text-[11px] font-semibold text-slate-850">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 shadow-[0_0_6px_rgba(79,70,229,0.6)]" />
                    <span>ภาพรวม</span>
                  </div>

                  {/* Item 2 */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] text-slate-400 font-medium hover:bg-slate-50 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-slate-300" />
                    <span>งานของฉัน</span>
                  </div>

                  {/* Item 3 */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11px] text-slate-400 font-medium hover:bg-slate-50 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-slate-300" />
                    <span>สมาชิกทีม</span>
                  </div>
                </div>
              </div>

              {/* Mini Board Area */}
              <div className="flex-1 bg-[#f0fdf4]/70 rounded-2xl p-3 border border-emerald-100/60">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-bold text-slate-800">แคมเปญเปิดตัว</span>
                  {/* 3 Status indicator dots */}
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-[#FBBF24]" />
                    <span className="w-3 h-3 rounded-full bg-[#2DD4BF]" />
                    <span className="w-3 h-3 rounded-full bg-[#818CF8]" />
                  </div>
                </div>

                {/* 3 Columns */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Col 1 */}
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block mb-1.5">
                      กำลังทำ
                    </span>
                    <div className="bg-white rounded-xl p-2 shadow-sm border border-slate-100/90 hover:shadow-md transition-shadow">
                      <p className="text-[10px] sm:text-[11px] font-medium text-slate-800 leading-tight line-clamp-2">
                        ออกแบบหน้าเว็บไซต์
                      </p>
                      <div className="h-1 w-full bg-blue-500 rounded-full mt-2" />
                    </div>
                  </div>

                  {/* Col 2 */}
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block mb-1.5">
                      รอตรวจ
                    </span>
                    <div className="bg-white rounded-xl p-2 shadow-sm border border-slate-100/90 hover:shadow-md transition-shadow">
                      <p className="text-[10px] sm:text-[11px] font-medium text-slate-800 leading-tight line-clamp-2">
                        ตรวจสอบเนื้อหา
                      </p>
                      <div className="h-1 w-full bg-pink-500 rounded-full mt-2" />
                    </div>
                  </div>

                  {/* Col 3 */}
                  <div>
                    <span className="text-[10px] text-slate-400 font-medium block mb-1.5">
                      เสร็จแล้ว
                    </span>
                    <div className="bg-white rounded-xl p-2 shadow-sm border border-slate-100/90 hover:shadow-md transition-shadow">
                      <p className="text-[10px] sm:text-[11px] font-medium text-slate-800 leading-tight line-clamp-2">
                        วางแผนโครงการ
                      </p>
                      <div className="h-1 w-full bg-emerald-500 rounded-full mt-2" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ช่องว่างด้านล่าง ให้เนื้อหากลางยังอยู่กึ่งกลางบนจอใหญ่ */}
        <div className="hidden lg:block" />
      </div>

      {/* ======================================================== */}
      {/* ฝั่งขวา — แบบฟอร์มเข้าสู่ระบบ / สมัครสมาชิก (ตรงตามภาพ) */}
      {/* ======================================================== */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-[450px]">
          {/* Main Card */}
          <div className="bg-white rounded-[32px] p-7 sm:p-10 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.06)] border border-slate-100">
            {/* Title & Subtitle */}
            <div className="mb-6">
              <h2 className="text-2xl sm:text-[26px] font-bold text-slate-900 tracking-tight flex items-center gap-2">
                {isLogin ? (
                  <>
                    <span>ยินดีต้อนรับกลับมา</span>
                    <Hand className="w-6 h-6 text-amber-500" />
                  </>
                ) : (
                  <>
                    <span>สร้างบัญชีใหม่</span>
                    <Sparkles className="w-6 h-6 text-indigo-500" />
                  </>
                )}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1.5 leading-relaxed">
                {isLogin
                  ? 'เข้าสู่ระบบเพื่อจัดการงานและเดินหน้าสู่เป้าหมายพร้อมกับทีมของคุณ'
                  : 'เริ่มต้นสร้างบัญชีเพื่อวางแผนและจัดการงานร่วมกับทีมได้อย่างไร้รอยต่อ'}
              </p>
            </div>

            {/* Notification / Alert Message */}
            {message && (
              <div
                className={`flex items-start gap-3 p-3.5 rounded-2xl mb-5 text-xs sm:text-sm animate-in fade-in duration-200 ${
                  message.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200/60 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200/60 text-rose-800'
                }`}
              >
                {message.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 leading-snug">{message.text}</div>
                <button
                  type="button"
                  onClick={() => setMessage(null)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ปุ่มเข้าสู่ระบบด้วย Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-2xl font-medium text-sm transition-all shadow-sm hover:shadow-md active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{isLogin ? 'เข้าสู่ระบบด้วย Google' : 'สมัครสมาชิกด้วย Google'}</span>
            </button>

            {/* เส้นคั่น "หรือเข้าสู่ระบบด้วยอีเมล" */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-slate-200/80" />
              <span className="text-[12px] text-slate-400 whitespace-nowrap">
                {isLogin ? 'หรือเข้าสู่ระบบด้วยอีเมล' : 'หรือสมัครสมาชิกด้วยอีเมล'}
              </span>
              <div className="flex-1 h-px bg-slate-200/80" />
            </div>

            {/* Email / Password Form */}
            <form onSubmit={isLogin ? handleEmailLogin : handleRegister} className="space-y-4">
              {/* ชื่อ-นามสกุล (เฉพาะโหมดสมัครสมาชิก) */}
              {!isLogin && (
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                    ชื่อ-นามสกุล
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <User className="w-5 h-5" />
                    </span>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="สมชาย ใจดี"
                      className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* ช่องกรอกอีเมล */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  อีเมล
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Mail className="w-5 h-5" />
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* ช่องกรอกรหัสผ่าน */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                  รหัสผ่าน
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock className="w-5 h-5" />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLogin ? 'กรอกรหัสผ่านของคุณ' : 'ตั้งรหัสผ่านอย่างน้อย 6 ตัวอักษร'}
                    className="w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* ยืนยันรหัสผ่าน (เฉพาะโหมดสมัครสมาชิก) */}
              {!isLogin && (
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-slate-700 mb-1.5">
                    ยืนยันรหัสผ่าน
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                      <Lock className="w-5 h-5" />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="ยืนยันรหัสผ่านอีกครั้ง"
                      className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* ลิงก์ "ลืมรหัสผ่าน?" (เฉพาะโหมดเข้าสู่ระบบ) */}
              {isLogin && (
                <div className="flex items-center justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email)
                      setShowForgotModal(true)
                      setForgotMessage(null)
                    }}
                    className="text-xs sm:text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline transition-colors cursor-pointer"
                  >
                    ลืมรหัสผ่าน?
                  </button>
                </div>
              )}

              {/* ปุ่ม Submit เข้าสู่ระบบ / สมัครสมาชิก ด้วย Gradient สีม่วง-ชมพู (ตรงตามภาพ) */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3.5 px-4 bg-gradient-to-r from-[#5B4DF0] via-[#7B3FE4] to-[#DF3CBA] hover:opacity-95 text-white font-semibold text-sm sm:text-base rounded-2xl shadow-[0_10px_25px_-5px_rgba(123,63,228,0.45)] hover:shadow-[0_15px_30px_-5px_rgba(123,63,228,0.55)] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                <span>
                  {loading
                    ? 'กำลังดำเนินการ...'
                    : isLogin
                    ? 'เข้าสู่ระบบ'
                    : 'สมัครสมาชิก'}
                </span>
              </button>
            </form>

            {/* สลับระหว่าง เข้าสู่ระบบ และ สมัครสมาชิก (ตรงตามภาพ) */}
            <div className="mt-6 text-center text-xs sm:text-sm text-slate-500">
              {isLogin ? (
                <>
                  <span>ยังไม่มีบัญชีใช่ไหม? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(false)
                      setMessage(null)
                    }}
                    className="text-indigo-600 font-semibold hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    สมัครสมาชิกฟรี
                  </button>
                </>
              ) : (
                <>
                  <span>มีบัญชีอยู่แล้ว? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(true)
                      setMessage(null)
                    }}
                    className="text-indigo-600 font-semibold hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    เข้าสู่ระบบ
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* Modal: รีเซ็ตรหัสผ่าน (Forgot Password Modal) */}
      {/* ======================================================== */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setShowForgotModal(false)}
              className="absolute right-5 top-5 text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-slate-900 mb-2 flex items-center gap-2">
              ลืมรหัสผ่านใช่ไหม?
              <KeyRound className="w-5 h-5 text-indigo-500" />
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mb-5 leading-relaxed">
              กรอกอีเมลที่คุณใช้สมัครสมาชิก เราจะส่งลิงก์สำหรับรีเซ็ตรหัสผ่านใหม่ไปยังอีเมลของคุณ
            </p>

            {forgotMessage && (
              <div
                className={`p-3 rounded-xl mb-4 text-xs sm:text-sm ${
                  forgotMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {forgotMessage.text}
              </div>
            )}

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">อีเมล</label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {forgotLoading ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ต'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}