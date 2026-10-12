import { AVATARS } from "@/lib/mock-data";

export default function AvatarStack({
  shown,
  extra,
}: {
  shown: number;
  extra: number;
}) {
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {AVATARS.slice(0, shown).map((src) => (
          <img
            key={src}
            src={src}
            alt=""
            className="h-7 w-7 rounded-full object-cover ring-2 ring-white"
          />
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-[12px] font-medium text-slate-400">+{extra}</span>
      )}
    </div>
  );
}
