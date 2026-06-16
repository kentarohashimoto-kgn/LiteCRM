import Link from "next/link";
import { getDealReads, parsePeriod } from "@/lib/data/exec";
import { saveOppReviewExtAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { formatYen, formatDateFull } from "@/lib/utils";

export default async function ExecDealsPage({ searchParams }: { searchParams: { month?: string; week?: string } }) {
  const { month, week } = parsePeriod(searchParams);
  const reviewWeek = `${month.slice(0, 7)}-01`;
  const { rows, summary } = await getDealReads();

  return (
    <div>
      <PageHeader title="商談・読み管理" subtitle="既存商談DBのA/B/C読みを参照し、当月成約見込み・停滞・次回アクション未設定を抽出。読み上げ方針や阻害要因を記録します。" />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {(["A", "B", "C"] as const).map((t) => (
          <div key={t} className="card card-pad">
            <div className="text-sm font-bold">{t}読み</div>
            <div className="stat-value stat-accent mt-1">{formatYen(summary[t].amount)}</div>
            <div className="text-xs text-ink/40 mt-0.5">{summary[t].count}件</div>
          </div>
        ))}
      </div>

      <Section title={`商談一覧（オープン ${rows.length}件・A→B→C順）`}>
        <div className="space-y-2">
          {rows.map((r) => (
            <details key={r.id} className="card card-pad">
              <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`pill text-[10px] font-bold ${r.tier === "A" ? "bg-teal-light text-teal-deep" : r.tier === "B" ? "bg-amber-100 text-amber-700" : "bg-mist-soft text-ink/50"}`}>{r.tier}</span>
                  <Link href={`/app/opportunities/${r.id}`} className="font-medium hover:text-teal-deep truncate">{r.account}</Link>
                  <span className="text-xs text-ink/45 truncate">{r.name}</span>
                </span>
                <span className="flex items-center gap-3 text-xs shrink-0">
                  <span className="tabular-nums font-semibold">{formatYen(r.amount)}</span>
                  <span className="text-ink/40">{r.expectedClose ? formatDateFull(r.expectedClose) : "受注予定日なし"}</span>
                  {r.flags.map((f) => <span key={f} className="pill bg-rose-50 text-rose-500 text-[10px]">{f}</span>)}
                </span>
              </summary>
              <form action={saveOppReviewExtAction} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="existing_opportunity_id" value={r.id} />
                <input type="hidden" name="review_week" value={reviewWeek} />
                <textarea name="read_up_plan" defaultValue={r.ext?.read_up_plan ?? ""} rows={2} placeholder="読み上げ方針（C→B、B→Aの対応）" className="input text-sm" />
                <textarea name="closing_plan" defaultValue={r.ext?.closing_plan ?? ""} rows={2} placeholder="クロージング計画（当月成約の具体策）" className="input text-sm" />
                <textarea name="blocking_issue" defaultValue={r.ext?.blocking_issue ?? ""} rows={2} placeholder="成約阻害要因（予算・決裁者・競合・時期・稟議）" className="input text-sm" />
                <textarea name="executive_comment" defaultValue={r.ext?.executive_comment ?? ""} rows={2} placeholder="幹部コメント" className="input text-sm" />
                <input name="next_check_point" defaultValue={r.ext?.next_check_point ?? ""} placeholder="次回MTGで確認すること" className="input text-sm md:col-span-2" />
                <button type="submit" className="btn-accent text-sm md:col-span-2">商談振り返りを保存</button>
              </form>
            </details>
          ))}
          {rows.length === 0 && <p className="text-sm text-ink/40 py-6 text-center">オープン商談がありません</p>}
        </div>
      </Section>
      <p className="text-xs text-ink/40 mt-3">※ A/B/C読みは既存商談のヨミ（1.A/2.B/3.C）を参照。読み上げ方針・クロージング計画などは商談に直接追加せず、振り返り拡張テーブルで管理します。対象月 {month.slice(0, 7)} 第{week}週。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
