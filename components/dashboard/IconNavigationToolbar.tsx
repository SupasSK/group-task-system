'use client'

import React, { useRef, useState, useEffect } from 'react'
import {
  Presentation,
  Printer,
  FileText,
  PenTool,
  Table2,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'

export interface NavToolbarItem {
  id: string
  label: string
  tooltip?: string
  icon: LucideIcon
  bgStyle: string
  iconColor?: string
  badge?: string
  badgeColor?: string
  hasDividerAfter?: boolean
}

// โครงสร้างเมนู 6 รายการตามที่กำหนด
export const DEFAULT_TOOLBAR_ITEMS: NavToolbarItem[] = [
  {
    id: 'presentations',
    label: 'พรีเซนเทชัน',
    tooltip: 'พรีเซนเทชัน (Presentations) — สร้างและนำเสนองาน',
    icon: Presentation,
    bgStyle: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-orange-200',
  },
  {
    id: 'prints',
    label: 'งานพิมพ์',
    tooltip: 'งานพิมพ์ (Prints) — สื่อสิ่งพิมพ์และจัดหน้าเอกสาร',
    icon: Printer,
    bgStyle: 'bg-gradient-to-br from-purple-600 to-violet-700 text-white shadow-purple-200',
  },
  {
    id: 'docs',
    label: 'เอกสาร',
    tooltip: 'เอกสาร (Docs) — เอกสารและรายงานโครงการ',
    icon: FileText,
    bgStyle: 'bg-gradient-to-br from-teal-400 to-emerald-600 text-white shadow-teal-200',
  },
  {
    id: 'whiteboards',
    label: 'ไวท์บอร์ด',
    tooltip: 'ไวท์บอร์ด (Whiteboards) — กระดานระดมสมองและวาดผังงาน',
    icon: PenTool,
    bgStyle: 'bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-emerald-200',
  },
  {
    id: 'sheets',
    label: 'ชีต',
    tooltip: 'ชีต (Sheets) — ตารางคำนวณและสเปรดชีต',
    icon: Table2,
    bgStyle: 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-sky-200',
  },
  {
    id: 'upload',
    label: 'อัปโหลด',
    tooltip: 'อัปโหลด (Upload) — อัปโหลดไฟล์หรือเอกสารใหม่',
    icon: UploadCloud,
    bgStyle: 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 shadow-slate-100',
    iconColor: 'text-slate-700',
  },
]

interface IconNavigationToolbarProps {
  items?: NavToolbarItem[]
  className?: string
  onSelect?: (id: string) => void
}

export default function IconNavigationToolbar({
  items = DEFAULT_TOOLBAR_ITEMS,
  className = '',
  onSelect,
}: IconNavigationToolbarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeId, setActiveId] = useState<string>('presentations')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)

  // ตรวจสอบตำแหน่ง Scroll เพื่อเปิด/ปิดปุ่มลูกศร ซ้าย-ขวา
  const checkScroll = () => {
    if (!scrollRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
    setCanScrollLeft(scrollLeft > 6)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 6)
  }

  useEffect(() => {
    checkScroll()
    const container = scrollRef.current
    if (container) {
      container.addEventListener('scroll', checkScroll, { passive: true })
      window.addEventListener('resize', checkScroll)
    }
    return () => {
      if (container) container.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [items])

  const handleScroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const scrollAmount = 240
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  const handleItemClick = (item: NavToolbarItem) => {
    setActiveId(item.id)
    if (onSelect) {
      onSelect(item.id)
    }

    if (item.id === 'upload' && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const fileName = files[0].name
      setUploadNotice(`อัปโหลดไฟล์ "${fileName}" สำเร็จ`)
      setTimeout(() => setUploadNotice(null), 3000)
    }
  }

  return (
    <nav
      aria-label="แถบเมนูเครื่องมือแนวนอนสไตล์ไอคอน"
      className={`relative w-full rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] px-3 py-3 transition-all ${className}`}
    >
      {/* Hidden File Input สำหรับปุ่ม อัปโหลด */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* แจ้งเตือนเมื่ออัปโหลดไฟล์สำเร็จ */}
      {uploadNotice && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 size={16} />
          <span>{uploadNotice}</span>
        </div>
      )}

      {/* ปุ่มเลื่อนไปทางซ้าย */}
      {canScrollLeft && (
        <div className="absolute left-1 top-0 bottom-0 z-20 flex items-center pr-4 bg-gradient-to-r from-white via-white/95 to-transparent rounded-l-2xl">
          <button
            type="button"
            onClick={() => handleScroll('left')}
            aria-label="เลื่อนเมนูไปทางซ้าย"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-600 shadow-md border border-slate-100 hover:bg-slate-50 hover:text-indigo-600 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* แถบเลื่อนเมนูแนวนอน (Flexbox) */}
      <div
        ref={scrollRef}
        role="menubar"
        className="flex items-center gap-4 sm:gap-6 overflow-x-auto scrollbar-none scroll-smooth px-2 py-1 justify-start md:justify-center"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => {
          const Icon = item.icon
          const isActive = activeId === item.id
          const isHovered = hoveredItemId === item.id

          return (
            <React.Fragment key={item.id}>
              <div className="relative flex items-center">
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={() => setHoveredItemId(item.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  onFocus={() => setHoveredItemId(item.id)}
                  onBlur={() => setHoveredItemId(null)}
                  className={`group relative flex flex-col items-center justify-center rounded-xl px-3 py-1.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 select-none cursor-pointer ${
                    isActive
                      ? 'bg-slate-50/90'
                      : 'hover:bg-slate-50/60'
                  }`}
                >
                  {/* กล่องไอคอนทรงกลม (44px) */}
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`relative flex h-[44px] w-[44px] items-center justify-center rounded-full ${item.bgStyle} shadow-sm transition-all duration-200 group-hover:scale-110 group-hover:shadow-md ${
                        isActive
                          ? 'ring-3 ring-indigo-500 ring-offset-2 ring-offset-white shadow-md'
                          : ''
                      }`}
                    >
                      <Icon
                        size={21}
                        strokeWidth={2.2}
                        className={item.iconColor || 'drop-shadow-sm'}
                      />
                    </div>

                    {/* ป้ายกำกับ Badge (ถ้ามี) */}
                    {item.badge && (
                      <span
                        className={`absolute -top-1 -right-2 rounded-full px-1.5 py-0.2 text-[9px] font-bold text-white shadow-sm ${
                          item.badgeColor || 'bg-purple-600'
                        } animate-pulse`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>

                  {/* ข้อความกำกับใต้ไอคอน (12-14px สีเทาเข้ม จัดกึ่งกลาง) */}
                  <span
                    className={`mt-2 text-center text-[13px] whitespace-nowrap leading-tight transition-colors duration-200 ${
                      isActive
                        ? 'font-bold text-indigo-700'
                        : 'font-medium text-slate-700 group-hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </span>

                  {/* Indicator ขีดเส้นใต้เมื่อ Active */}
                  {isActive && (
                    <span className="absolute bottom-0 h-0.5 w-6 rounded-full bg-indigo-600" />
                  )}
                </button>

                {/* Tooltip เมื่อ Hover */}
                {isHovered && item.tooltip && (
                  <div
                    role="tooltip"
                    className="absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900/90 backdrop-blur-sm px-2.5 py-1 text-[11px] font-medium text-white shadow-lg pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95"
                  >
                    {item.tooltip}
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 border-x-4 border-x-transparent border-b-4 border-b-slate-900/90" />
                  </div>
                )}
              </div>

              {/* เส้นแบ่งแนวตั้ง (ถ้ามี) */}
              {item.hasDividerAfter && (
                <div
                  aria-hidden="true"
                  className="mx-1 h-8 w-[1px] bg-slate-200 shrink-0 self-center"
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* ปุ่มเลื่อนไปทางขวา */}
      {canScrollRight && (
        <div className="absolute right-1 top-0 bottom-0 z-20 flex items-center pl-4 bg-gradient-to-l from-white via-white/95 to-transparent rounded-r-2xl">
          <button
            type="button"
            onClick={() => handleScroll('right')}
            aria-label="เลื่อนเมนูไปทางขวา"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-600 shadow-md border border-slate-100 hover:bg-slate-50 hover:text-indigo-600 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </nav>
  )
}
