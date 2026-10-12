export const DEMO_USER = {
  name: "สมชาย แสนดี",
  role: "ผู้ดูแลโครงการ",
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=128&h=128&fit=crop&crop=faces",
};

export const AVATARS = [
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&crop=faces",
];

export type ProjectCard = {
  id: string;
  title: string;
  description: string;
  progress: number;
  members: number;
  shownAvatars: number;
};

export const PROJECTS: ProjectCard[] = [
  {
    id: "p1",
    title: "แอปพลิเคชันเดลิเวอรี่อาหาร",
    description: "พัฒนาแอปสำหรับร้านอาหารในชุมชนให้ครอบคลุมรอบพื้นที่",
    progress: 75,
    members: 6,
    shownAvatars: 3,
  },
  {
    id: "p2",
    title: "ปรับปรุงเว็บไซต์องค์กร",
    description: "Redesign เว็บเก่าให้อยู่ในระบบ Cloud ปลอดภัยและทันสมัย",
    progress: 40,
    members: 4,
    shownAvatars: 3,
  },
  {
    id: "p3",
    title: "ระบบคลังสินค้าอัจฉริยะ",
    description: "เชื่อมต่อ IoT กับระบบตรวจสอบสต็อกสินค้าเรียลไทม์",
    progress: 95,
    members: 8,
    shownAvatars: 3,
  },
  {
    id: "p4",
    title: "แคมเปญการตลาดดิจิทัล Q4",
    description: "วางแผนยิงโฆษณาและส่งเสริมการขายช่วงสิ้นปี",
    progress: 15,
    members: 5,
    shownAvatars: 3,
  },
  {
    id: "p5",
    title: "พัฒนาระบบหลังบ้าน ERP",
    description: "อัปเกรดเซิร์ฟเวอร์และโครงสร้างพื้นฐานข้อมูลองค์กร",
    progress: 60,
    members: 3,
    shownAvatars: 3,
  },
  {
    id: "p6",
    title: "วิจัยความพึงพอใจลูกค้า",
    description: "สรุปผลและสร้างโมเดลความพึงพอใจด้วย AI",
    progress: 100,
    members: 2,
    shownAvatars: 2,
  },
];

export type KanbanTask = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  avatar: string;
  priority: "ต่ำ" | "ปานกลาง" | "สูง" | "เสร็จแล้ว";
  date: string;
  dateTone?: "pink";
  highlight?: boolean;
};

export const KANBAN: Record<"todo" | "doing" | "done", KanbanTask[]> = {
  todo: [
    {
      id: "t1",
      title: "เขียนเทสเคสสำหรับระบบชำระเงิน",
      description: "ครอบคลุมเคสชำระผ่านบัตรและวอลเล็ต",
      assignee: "วิภา ใจงาม",
      avatar: AVATARS[1],
      priority: "ต่ำ",
      date: "25 ต.ค. 2566",
    },
    {
      id: "t2",
      title: "ออกแบบหน้าโปรไฟล์ร้านค้า",
      description: "แสดงเมนู รีวิว และเวลาเปิด-ปิดร้าน",
      assignee: "นที ทองดี",
      avatar: AVATARS[2],
      priority: "ปานกลาง",
      date: "27 ต.ค. 2566",
    },
  ],
  doing: [
    {
      id: "t3",
      title: "พัฒนาหน้าโปรไฟล์ผู้ใช้งาน",
      description: "แก้ไขที่อยู่ เบอร์โทร และประวัติคำสั่งซื้อ",
      assignee: "นที ทองดี",
      avatar: AVATARS[2],
      priority: "สูง",
      date: "วันนี้",
      dateTone: "pink",
      highlight: true,
    },
    {
      id: "t4",
      title: "เชื่อมต่อ API ติดตามพัสดุ",
      description: "แสดงสถานะการจัดส่งแบบเรียลไทม์",
      assignee: "วิภา ใจงาม",
      avatar: AVATARS[1],
      priority: "ปานกลาง",
      date: "28 ต.ค. 2566",
    },
  ],
  done: [
    {
      id: "t5",
      title: "ตั้งค่าฐานข้อมูลคำสั่งซื้อ",
      description: "ออกแบบ schema และ seed ข้อมูลทดสอบ",
      assignee: "สมชาย แสนดี",
      avatar: AVATARS[0],
      priority: "เสร็จแล้ว",
      date: "18 ต.ค. 2566",
    },
    {
      id: "t6",
      title: "จัดทำเอกสารข้อกำหนดระบบ",
      description: "สรุปขอบเขตงานและบทบาทของทีม",
      assignee: "วรัญญา มีสุข",
      avatar: AVATARS[3],
      priority: "เสร็จแล้ว",
      date: "20 ต.ค. 2566",
    },
  ],
};

export const TEAM_MEMBERS = [
  {
    name: "สมชาย แสนดี",
    email: "somchai.s@gmail.com",
    role: "leader" as const,
    initials: "สช",
    color: "bg-blue-500",
  },
  {
    name: "นที ทองดี",
    email: "natee.t@gmail.com",
    role: "member" as const,
    initials: "นท",
    color: "bg-emerald-500",
  },
  {
    name: "วรัญญา มีสุข",
    email: "waranya.m@gmail.com",
    role: "member" as const,
    initials: "วญ",
    color: "bg-orange-400",
  },
];
