import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// อ่าน origin ของ Supabase จาก env (ห้ามฝัง URL ในโค้ด) เพื่ออนุญาตเรียก API และโหลดรูปโปรไฟล์จาก Storage
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";

// CSP แบบไม่ใช้ nonce ตามคู่มือ Next.js (Next.js ต้องใช้ 'unsafe-inline' สำหรับ script ที่ฝังในหน้า)
const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://*.googleusercontent.com ${supabaseOrigin};
  font-src 'self';
  connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp.replace(/\s{2,}/g, " ").trim() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
