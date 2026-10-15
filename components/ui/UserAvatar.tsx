'use client'

import { useState } from 'react'

// รูปโปรไฟล์: ส่ง src เป็น custom_avatar_url ?? avatar_url (รูปที่อัปโหลดเองก่อนรูป Google)
// ไม่มีรูปหรือโหลดรูปไม่ได้ จะแสดงตัวอักษรแรกของชื่อแทน
export default function UserAvatar({
  src,
  name,
  className = '',
}: {
  src?: string | null
  name: string
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && src !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={`shrink-0 object-cover ${className}`}
      />
    )
  }

  return (
    <div className={`flex shrink-0 items-center justify-center font-bold ${className}`}>
      {(name.charAt(0) || '?').toUpperCase()}
    </div>
  )
}
