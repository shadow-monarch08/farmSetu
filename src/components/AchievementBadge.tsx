type AchievementBadgeProps = {
  title: string;
  description: string;
  unlocked: boolean;
};

export function AchievementBadge({ title, description, unlocked }: AchievementBadgeProps) {
  return (
    <article
      className={`rounded-xl border p-4 transition-all duration-300 ${
        unlocked
          ? "border-teal-300/45 bg-teal-400/10 shadow-[0_0_24px_rgba(45,212,191,0.25)]"
          : "border-slate-700/70 bg-slate-900/50 opacity-75"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-300">{unlocked ? "Unlocked" : "Locked"}</span>
        <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      </div>
      <p className="text-xs text-slate-400">{description}</p>
    </article>
  );
}
