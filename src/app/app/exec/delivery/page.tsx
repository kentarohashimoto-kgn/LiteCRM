import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers, getUser, getAccount } from "@/lib/data/select";
import { listDeliveryReviews } from "@/lib/data/exec";
import { saveDeliveryReviewAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { DELIVERY_TYPES, DELIVERY_TYPE_LABEL, DELIVERY_STATUS, EVALUATION_META, judgeDelivery } from "@/lib/exec-review";
import { formatDateFull } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function ExecDeliveryPage() {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => user);
  const accounts = ws.accounts;
  const reviews = await listDeliveryReviews();

  return (
    <div>
      <PageHeader title="デリバリー品質管理" subtitle="研修満足度・講師品質・事務手続き・事前準備を管理し、低評価や遅延に対策を打ちます。" />

      <Section title="研修・品質レビューを追加" className="mb-5">
        <form action={saveDeliveryReviewAction} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="customer_id" className="input"><option value="">顧客</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input name="project_name" placeholder="研修・案件名" className="input" />
          <select name="delivery_type" defaultValue="training" className="input">{DELIVERY_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
          <input name="execution_date" type="date" className="input" title="実施日" />
          <select name="instructor_user_id" className="input"><option value="">講師</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <input name="participants_count" type="number" placeholder="受講人数" className="input" />
          <input name="satisfaction_score" type="number" step="0.1" placeholder="満足度(例:2.4)" className="input" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="issue_flag" value="1" className="accent-teal-primary" /> 低評価/課題あり</label>
          <select name="status" defaultValue="open" className="input">{DELIVERY_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <input name="issue_detail" placeholder="課題内容" className="input md:col-span-2" />
          <input name="countermeasure" placeholder="対策" className="input" />
          <SubmitButton className="btn-primary md:col-span-3" pendingLabel="追加中…">追加</SubmitButton>
        </form>
      </Section>

      <div className="space-y-2">
        {reviews.map((r) => {
          const j = judgeDelivery({ satisfaction: r.satisfaction_score, issueFlag: r.issue_flag, countermeasure: r.countermeasure });
          const m = EVALUATION_META[j.evaluation];
          return (
            <details key={r.id} className="card card-pad">
              <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`pill text-[10px] font-bold ${m.color}`}>{m.label}</span>
                  <span className="font-medium truncate">{r.project_name || (r.customer_id ? getAccount(ws, r.customer_id)?.name : "—")}</span>
                  <span className="text-xs text-ink/45">{DELIVERY_TYPE_LABEL[r.delivery_type]}</span>
                </span>
                <span className="flex items-center gap-3 text-xs shrink-0">
                  <span>満足度 <b className="tabular-nums">{r.satisfaction_score ?? "—"}</b></span>
                  <span>{r.instructor_user_id ? getUser(ws, r.instructor_user_id)?.name : ""}</span>
                  <span className="text-ink/40">{formatDateFull(r.execution_date)}</span>
                </span>
              </summary>
              {j.reasons.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{j.reasons.map((x) => <span key={x} className="pill bg-amber-50 text-accent-orange text-[10px]">{x}</span>)}</div>}
              <form action={saveDeliveryReviewAction} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="customer_id" value={r.customer_id ?? ""} />
                <input type="hidden" name="project_name" value={r.project_name ?? ""} />
                <input type="hidden" name="delivery_type" value={r.delivery_type} />
                <input type="hidden" name="execution_date" value={r.execution_date ?? ""} />
                <input type="hidden" name="instructor_user_id" value={r.instructor_user_id ?? ""} />
                <input name="satisfaction_score" type="number" step="0.1" defaultValue={r.satisfaction_score ?? ""} placeholder="満足度" className="input text-sm" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="issue_flag" value="1" defaultChecked={r.issue_flag} className="accent-teal-primary" /> 課題あり</label>
                <select name="status" defaultValue={r.status} className="input text-sm">{DELIVERY_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                <input name="issue_detail" defaultValue={r.issue_detail ?? ""} placeholder="課題内容" className="input text-sm md:col-span-2" />
                <input name="countermeasure" defaultValue={r.countermeasure ?? ""} placeholder="対策（低評価時は必須）" className="input text-sm" />
                <SubmitButton className="btn-accent text-sm md:col-span-3" pendingLabel="更新中…">更新</SubmitButton>
              </form>
            </details>
          );
        })}
        {reviews.length === 0 && <p className="text-sm text-ink/40 py-6 text-center card card-pad">レビューはまだありません</p>}
      </div>
      <p className="text-xs text-ink/40 mt-3">※ 判定: 満足度2.3以上Good / 2.0以上Watch / 未満Bad。低評価・課題ありで対策未記入はBad。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
