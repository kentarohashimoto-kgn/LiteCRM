/** 対象月・対象週セレクタ(GETフォームでサーバー側に反映)。 */
export function PeriodSelect({ month, week, weeks, basePath }: { month: string; week: number; weeks: number; basePath: string }) {
  return (
    <form method="get" action={basePath} className="inline-flex items-end gap-2">
      <div>
        <label className="label">対象月</label>
        <input type="month" name="month" defaultValue={month.slice(0, 7)} className="input py-1.5" />
      </div>
      <div>
        <label className="label">対象週</label>
        <select name="week" defaultValue={String(week)} className="input py-1.5">
          {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => <option key={w} value={w}>第{w}週</option>)}
        </select>
      </div>
      <button type="submit" className="btn-ghost text-sm">適用</button>
    </form>
  );
}
