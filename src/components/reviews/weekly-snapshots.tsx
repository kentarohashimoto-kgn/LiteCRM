import { Camera, Trash2, GitCompareArrows } from "lucide-react";
import { Section, EmptyState } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatYen, formatPercent, formatDate, formatTimeJst, cn } from "@/lib/utils";
import { saveWeeklySnapshotAction, deleteWeeklySnapshotAction } from "@/server/actions/weekly-snapshot";
import type { WeeklySnapshotMeta, WeeklySnapshotFull, WeeklyPayload } from "@/lib/data/weekly-snapshot";

type MetricType = "yen" | "pct" | "num";
type MetricRow = { label: string; type: MetricType; get: (p: WeeklyPayload) => number };

const ROWS: MetricRow[] = [
  { label: "今月 目標", type: "yen", get: (p) => p.months[0]?.target ?? 0 },
  { label: "今月 Commit", type: "yen", get: (p) => p.months[0]?.commit ?? 0 },
  { label: "今月 Best Case", type: "yen", get: (p) => p.months[0]?.bestCase ?? 0 },
  { label: "今月 Weighted", type: "yen", get: (p) => p.months[0]?.weighted ?? 0 },
  { label: "今月 Gap(見込-目標)", type: "yen", get: (p) => p.months[0]?.gap ?? 0 },
  { label: "今月 達成率", type: "pct", get: (p) => p.months[0]?.achieve ?? 0 },
  { label: "来月 Best Case", type: "yen", get: (p) => p.months[1]?.bestCase ?? 0 },
  { label: "商談(進行中) 件数", type: "num", get: (p) => p.pipeline.openCount },
  { label: "商談(進行中) 金額", type: "yen", get: (p) => p.pipeline.openAmount },
  { label: "Weighted(全体)", type: "yen", get: (p) => p.pipeline.weighted },
  { label: "停滞(放置)案件", type: "num", get: (p) => p.pipeline.stalled },
  { label: "危険案件", type: "num", get: (p) => p.pipeline.risky },
  { label: "今月クローズ予定 件数", type: "num", get: (p) => p.pipeline.closingCount },
  { label: "今月クローズ予定 金額", type: "yen", get: (p) => p.pipeline.closingAmount },
];

function fmt(v: number, t: MetricType): string {
  if (t === "yen") return formatYen(v);
  if (t === "pct") return formatPercent(v);
  return String(v);
}

function DeltaCell({ a, b, t }: { a: number; b: number; t: MetricType }) {
  const d = b - a;
  if (d === 0) return <span className="text-ink/30">±0</span>;
  const up = d > 0;
  const sign = up ? "+" : "−";
  const body = t === "pct" ? formatPercent(Math.abs(d)) : t === "yen" ? formatYen(Math.abs(d)) : String(Math.abs(d));
  return <span className={cn("font-semibold", up ? "text-emerald-600" : "text-rose-600")}>{sign}{body}</span>;
}

function CompareTable({ a, b }: { a: WeeklySnapshotFull; b: WeeklySnapshotFull }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th className="th">指標</th>
            <th className="th text-right">A：{formatDate(a.week_start)}週<div className="text-[10px] font-normal text-ink/40">{formatTimeJst(a.taken_at)}</div></th>
            <th className="th text-right">B：{formatDate(b.week_start)}週<div className="text-[10px] font-normal text-ink/40">{formatTimeJst(b.taken_at)}</div></th>
            <th className="th text-right">Δ (B−A)</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className="row-hover border-t border-black/[0.04]">
              <td className="td">{r.label}</td>
              <td className="td text-right">{fmt(r.get(a.payload), r.type)}</td>
              <td className="td text-right font-medium">{fmt(r.get(b.payload), r.type)}</td>
              <td className="td text-right"><DeltaCell a={r.get(a.payload)} b={r.get(b.payload)} t={r.type} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeeklySnapshotsView({
  list,
  compareA,
  compareB,
}: {
  list: WeeklySnapshotMeta[];
  compareA?: WeeklySnapshotFull;
  compareB?: WeeklySnapshotFull;
}) {
  const optionLabel = (s: WeeklySnapshotMeta) =>
    `${formatDate(s.week_start)}週 (${formatTimeJst(s.taken_at)})${s.note ? " ｜ " + s.note : ""}`;

  return (
    <div className="space-y-6">
      {/* 保存 */}
      <Section title="現在の週次サマリを保存" icon={<Camera size={15} className="text-teal-primary" />}>
        <form action={saveWeeklySnapshotAction} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-ink/50 mb-1">メモ(任意)</label>
            <input
              name="note"
              placeholder="例: 第2四半期キックオフ後 / 展示会フォロー中"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-teal-primary focus:outline-none"
            />
          </div>
          <SubmitButton className="btn-primary" pendingLabel="保存中…">この瞬間を保存</SubmitButton>
        </form>
        <p className="mt-2 text-xs text-ink/45">保存すると、その時点の目標・着地見込み・パイプライン・担当別が固定され、後から同じ数字で振り返れます。</p>
      </Section>

      {/* 比較 */}
      <Section title="2世代を比較" icon={<GitCompareArrows size={15} className="text-teal-primary" />}>
        {list.length < 2 ? (
          <EmptyState message="比較にはスナップショットが2件以上必要です。まず保存を続けてください。" />
        ) : (
          <>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink/50 mb-1">A（基準）</label>
                <select name="a" defaultValue={compareA?.id ?? ""} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
                  <option value="" disabled>選択…</option>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>{optionLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink/50 mb-1">B（比較先）</label>
                <select name="b" defaultValue={compareB?.id ?? ""} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
                  <option value="" disabled>選択…</option>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>{optionLabel(s)}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn-ghost">比較する</button>
            </form>

            {compareA && compareB ? (
              <div className="mt-4">
                <CompareTable a={compareA} b={compareB} />
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink/45">AとBを選んで「比較する」を押すと、増減がここに並びます。</p>
            )}
          </>
        )}
      </Section>

      {/* 履歴 */}
      <Section title={`保存済みスナップショット（${list.length}）`}>
        {list.length === 0 ? (
          <EmptyState message="まだスナップショットがありません。上の「この瞬間を保存」で最初の1件を作成してください。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="th">対象週</th>
                  <th className="th">保存日時</th>
                  <th className="th">メモ</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="row-hover border-t border-black/[0.04]">
                    <td className="td">{formatDate(s.week_start)}週</td>
                    <td className="td text-ink/70">{formatTimeJst(s.taken_at)}</td>
                    <td className="td text-ink/70">{s.note ?? "—"}</td>
                    <td className="td text-right">
                      <form action={deleteWeeklySnapshotAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="text-ink/30 hover:text-rose-600 transition-colors" title="削除" aria-label="削除">
                          <Trash2 size={15} />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
