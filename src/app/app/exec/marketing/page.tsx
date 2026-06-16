import Link from "next/link";
import { getMarketingReview, parsePeriod, weeksInMonth } from "@/lib/data/exec";
import { saveCampaignReviewExtAction } from "@/server/actions";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { PeriodSelect } from "@/components/exec/period-select";
import { EVALUATION_META, CAMPAIGN_PREP_STATUS, PREP_LABEL } from "@/lib/exec-review";
import { formatYen, formatDateFull } from "@/lib/utils";

const CH_LABEL: Record<string, string> = { exhibition: "展示会", seminar: "セミナー", agency: "代理店", media_ipros: "広告", media_aismiley: "広告", sns: "SNS", networking: "交流", whitelist_call: "リスト架電", exec_appt_bt: "経営者アポ", exec_appt_rm: "経営者アポ", other: "その他" };

export default async function ExecMarketingPage({ searchParams }: { searchParams: { month?: string; week?: string } }) {
  const { month, week } = parsePeriod(searchParams);
  const { rows, leadTarget, planLeads, coverage, upcoming } = await getMarketingReview(month);
  const coverEval = coverage == null ? "watch" : coverage >= 1 ? "good" : coverage >= 0.6 ? "watch" : "bad";
  const cm = EVALUATION_META[coverEval as keyof typeof EVALUATION_META];

  return (
    <div>
      <PageHeader
        title="マーケ施策管理"
        subtitle="月別リード目標に対し、展示会・セミナー・広告等の施策が十分・適切に準備されているかを確認します（既存の施策データを参照）。"
        action={<PeriodSelect month={month} week={week} weeks={weeksInMonth(month)} basePath="/app/exec/marketing" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">月間リード目標</div><div className="text-2xl font-bold mt-1 tabular-nums">{leadTarget || "—"}</div></Card>
        <Card><div className="text-xs text-ink/50">施策の獲得見込み</div><div className="text-2xl font-bold mt-1 tabular-nums">{planLeads}</div></Card>
        <Card><div className="text-xs text-ink/50">目標カバー率</div><div className="text-2xl font-bold mt-1 tabular-nums">{coverage == null ? "—" : `${Math.round(coverage * 100)}%`}</div></Card>
        <Card><div className="text-xs text-ink/50">判定</div><div className="mt-2"><span className={`pill text-sm font-bold ${cm.color}`}>{cm.label}</span></div><div className="text-[11px] text-ink/40 mt-1">施策見込みが目標比60%未満でBad</div></Card>
      </div>

      {upcoming.length > 0 && (
        <Section title="1ヶ月前 準備チェック（実施30日以内・準備未完）" className="mb-5">
          <ul className="divide-y divide-black/[0.05]">
            {upcoming.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between text-sm">
                <span>{c.name}<span className="text-xs text-ink/45 ml-2">{CH_LABEL[c.channel] ?? c.channel}・{formatDateFull(c.eventDate)}（あと{c.daysToEvent}日）</span></span>
                <span className="pill bg-rose-50 text-rose-500 text-[10px]">{PREP_LABEL[c.prepStatus]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`当月の施策（${rows.length}件）`}>
        <div className="space-y-2">
          {rows.map((c) => {
            const m = EVALUATION_META[c.evaluation];
            return (
              <details key={c.id} className="card card-pad">
                <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`pill text-[10px] font-bold ${m.color}`}>{m.label}</span>
                    <Link href={`/app/analytics/exhibitions`} className="font-medium hover:text-teal-deep truncate">{c.name}</Link>
                    <span className="text-xs text-ink/45">{CH_LABEL[c.channel] ?? c.channel}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs shrink-0 tabular-nums">
                    <span>リード {c.actualLeads}/{c.expectedLeads}</span>
                    <span>アポ {c.appts}</span>
                    <span>CPA {c.cpaActual != null ? formatYen(c.cpaActual) : "—"}</span>
                    <span className="pill bg-mist-soft text-ink/50 text-[10px]">{PREP_LABEL[c.prepStatus]}</span>
                  </span>
                </summary>
                {c.reasons.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{c.reasons.map((r) => <span key={r} className="pill bg-amber-50 text-accent-orange text-[10px]">{r}</span>)}</div>}
                <form action={saveCampaignReviewExtAction} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-black/[0.05] pt-3">
                  <input type="hidden" name="campaign_id" value={c.id} />
                  <input type="hidden" name="review_week" value={month} />
                  <div><label className="label">準備ステータス</label><select name="prep_status" defaultValue={c.prepStatus} className="input">{CAMPAIGN_PREP_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
                  <div></div>
                  <textarea name="review_comment" defaultValue={c.ext?.review_comment ?? ""} rows={2} placeholder="振り返り（良かった点・悪かった点）" className="input text-sm" />
                  <textarea name="next_improvement" defaultValue={c.ext?.next_improvement ?? ""} rows={2} placeholder="次回改善点" className="input text-sm" />
                  <button type="submit" className="btn-accent text-sm md:col-span-2">施策の振り返りを保存</button>
                </form>
              </details>
            );
          })}
          {rows.length === 0 && <p className="text-sm text-ink/40 py-6 text-center">当月の施策がありません</p>}
        </div>
      </Section>
      <p className="text-xs text-ink/40 mt-3">※ 施策・実績(リード/アポ/費用)は既存の施策(campaigns)を参照。月間リード目標は目標入力(sales_targets)を参照。振り返りメモのみ新規テーブルで保持します。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
