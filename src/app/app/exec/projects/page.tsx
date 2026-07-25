import { getWorkspaceLite } from "@/lib/data/workspace";
import { MoneyInput } from "@/components/ui/money-input";
import { getAccount } from "@/lib/data/select";
import { listProjectProfitReviews } from "@/lib/data/exec";
import { saveProjectReviewAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { PROJECT_TYPES, PROJECT_TYPE_LABEL, CONTINUATION_STATUS, CONTINUATION_LABEL, EVALUATION_META, judgeProject } from "@/lib/exec-review";
import { formatYen, formatPercent } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function ExecProjectsPage() {
  const ws = await getWorkspaceLite();
  const accounts = ws.accounts;
  const reviews = await listProjectProfitReviews();

  return (
    <div>
      <PageHeader title="開発・顧問案件管理" subtitle="開発・顧問案件の原価超過・粗利低下・品質/納期リスク・継続リスクを管理します。" />

      <Section title="案件レビューを追加" className="mb-5">
        <form action={saveProjectReviewAction} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select name="project_type" defaultValue="dev" className="input">{PROJECT_TYPES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          <select name="customer_id" className="input"><option value="">顧客</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input name="project_name" placeholder="案件名" className="input md:col-span-2" />
          <input name="contract_amount" type="number" placeholder="契約金額" className="input" />
          <MoneyInput name="planned_cost" placeholder="予定原価" className="input" />
          <MoneyInput name="actual_cost" placeholder="実績原価" className="input" />
          <input name="forecast_cost" type="number" placeholder="着地見込み原価" className="input" />
          <input name="quality_risk" placeholder="品質/納期リスク(あり等)" className="input" />
          <select name="continuation_status" defaultValue="" className="input"><option value="">継続状況</option>{CONTINUATION_STATUS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          <input name="satisfaction_status" placeholder="顧客満足(不満等)" className="input" />
          <input name="countermeasure" placeholder="対策" className="input" />
          <SubmitButton className="btn-primary md:col-span-4" pendingLabel="追加中…">追加</SubmitButton>
        </form>
      </Section>

      <div className="space-y-2">
        {reviews.map((r) => {
          const j = judgeProject({ projectType: r.project_type, contractAmount: r.contract_amount, plannedCost: r.planned_cost, forecastCost: r.forecast_cost, plannedGp: r.planned_gross_profit, forecastGp: r.forecast_gross_profit, qualityRisk: r.quality_risk, costRisk: r.cost_risk, continuation: r.continuation_status, satisfaction: r.satisfaction_status });
          const m = EVALUATION_META[j.evaluation];
          const costRatio = r.planned_cost > 0 ? r.forecast_cost / r.planned_cost : null;
          return (
            <details key={r.id} className="card card-pad">
              <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`pill text-[10px] font-bold ${m.color}`}>{m.label}</span>
                  <span className="font-medium truncate">{r.project_name || (r.customer_id ? getAccount(ws, r.customer_id)?.name : "—")}</span>
                  <span className="text-xs text-ink/45">{PROJECT_TYPE_LABEL[r.project_type]}</span>
                </span>
                <span className="flex items-center gap-3 text-xs shrink-0 tabular-nums">
                  <span>契約 {formatYen(r.contract_amount)}</span>
                  <span>原価 {costRatio != null ? formatPercent(costRatio) : "—"}</span>
                  <span>粗利率 {j.gpRate != null ? formatPercent(j.gpRate) : "—"}</span>
                </span>
              </summary>
              {j.reasons.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{j.reasons.map((x) => <span key={x} className="pill bg-amber-50 text-accent-orange text-[10px]">{x}</span>)}</div>}
              <form action={saveProjectReviewAction} className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="project_type" value={r.project_type} />
                <input type="hidden" name="customer_id" value={r.customer_id ?? ""} />
                <input type="hidden" name="project_name" value={r.project_name ?? ""} />
                <div><label className="label">契約金額</label><input name="contract_amount" type="number" defaultValue={r.contract_amount} className="input text-sm" /></div>
                <div><label className="label">予定原価</label><MoneyInput name="planned_cost" defaultValue={r.planned_cost} placeholder="" className="input text-sm" /></div>
                <div><label className="label">実績原価</label><MoneyInput name="actual_cost" defaultValue={r.actual_cost} placeholder="" className="input text-sm" /></div>
                <div><label className="label">着地見込原価</label><input name="forecast_cost" type="number" defaultValue={r.forecast_cost} className="input text-sm" /></div>
                <div><label className="label">品質/納期リスク</label><input name="quality_risk" defaultValue={r.quality_risk ?? ""} className="input text-sm" /></div>
                <div><label className="label">継続状況</label><select name="continuation_status" defaultValue={r.continuation_status ?? ""} className="input text-sm"><option value="">—</option>{CONTINUATION_STATUS.map((c) => <option key={c.key} value={c.key}>{CONTINUATION_LABEL[c.key]}</option>)}</select></div>
                <div><label className="label">顧客満足</label><input name="satisfaction_status" defaultValue={r.satisfaction_status ?? ""} className="input text-sm" /></div>
                <div><label className="label">対策</label><input name="countermeasure" defaultValue={r.countermeasure ?? ""} className="input text-sm" /></div>
                <SubmitButton className="btn-accent text-sm col-span-2 md:col-span-4" pendingLabel="更新中…">更新</SubmitButton>
              </form>
            </details>
          );
        })}
        {reviews.length === 0 && <p className="text-sm text-ink/40 py-6 text-center card card-pad">レビューはまだありません</p>}
      </div>
      <p className="text-xs text-ink/40 mt-3">※ 判定: 着地原価が予定比110%超でBad。粗利率が計画比80%未満でBad。顧客不満・顧問の翌月継続未確認も警告します。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
