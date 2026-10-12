import type { Metadata } from "next";

import "./globals.css";



export const metadata: Metadata = {
  title: "GroupTask - ระบบบริหารจัดการการทำงานกลุ่ม",
  description: "ระบบช่วยบริหารจัดการงานและโครงการร่วมกันภายในกลุ่ม",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className="antialiased text-slate-800">
        {children}
      </body>
    </html>
  );
}
