import ProgressBar from "@/components/ui/ProgressBar";

const rows = [
  { name: "สมชาย แสนดี", tasks: 12, done: 9 },
  { name: "นที ทองดี", tasks: 8, done: 5 },
  { name: "วรัญญา มีสุข", tasks: 6, done: 4 },
];

export default function ContributionsPage() {
  return (
    <div>
      <h1 className="mb-7 text-[28px] font-bold text-slate-800">ผลการมีส่วนร่วม</h1>
      <div className="grid gap-4">
        {rows.map((row) => (
          <section key={row.name} className="gt-card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">{row.name}</h2>
              <span className="text-[13px] text-slate-400">
                เสร็จแล้ว {row.done}/{row.tasks} งาน
              </span>
            </div>
            <ProgressBar value={Math.round((row.done / row.tasks) * 100)} />
          </section>
        ))}
      </div>
    </div>
  );
}
