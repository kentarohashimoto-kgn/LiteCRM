import { listExhibitionCandidates } from "@/lib/data/exhibition";
import { saveExhibitionCandidateAction, setExhibitionStatusAction, setExhibitionDecisionAction, deleteExhibitionCandidateAction } from "@/server/actions";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { EXH_STATUS, EXH_STATUS_LABEL, EXH_DECISION, EXH_DECISION_LABEL, THEME_FIT, EXH_RANK_COLOR } from "@/lib/exhibition";
import { formatYen, formatDateFull, cn } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

function pctRoi(v: number | null) { return v == null ? "—" : `${Math.round(v * 100)}%`; }

export default async function ExhibitionSelectPage() {
  const rows = await listExhibitionCandidates();
  const active = rows.filter((r) => r.status === "considering" || r.status === "apply_planned");
  const totalLeads = active.reduce((s, r) => s + (r.expected_leads ?? 0), 0);
  const totalCost = active.reduce((s, r) => s + r.score.cost, 0);
  const totalRev = active.reduce((s, r) => s + r.revenue, 0);
  const approved = rows.filter((r) => r.decision === "approved").length;

  return (
    <div>
      <PageHeader title="展示会選定" subtitle="候補を登録すると、想定リード・テーマ相性・ROI・リード単価・日程の詰まりから自動でスコア／ランクを算出。色分けを見て幹部が最終決定します。" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">検討中の候補</div><div className="text-2xl font-bold mt-1">{active.length}</div></Card>
        <Card><div className="text-xs text-ink/50">出展承認</div><div className="text-2xl font-bold mt-1 stat-accent">{approved}</div></Card>
        <Card><div className="text-xs text-ink/50">想定リード(検討中計)</div><div className="text-xl font-bold mt-1 tabular-nums">{totalLeads.toLocaleString()}</div></Card>
        <Card><div className="text-xs text-ink/50">想定費用(検討中計)</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(totalCost)}</div></Card>
        <Card><div className="text-xs text-ink/50">想定売上(検討中計)</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(totalRev)}</div></Card>
      </div>

      <Section title="展示会候補を登録" className="mb-5">
        <form action={saveExhibitionCandidateAction} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input name="name" placeholder="展示会名 *" className="input md:col-span-2" required />
          <input name="organizer" placeholder="運営元" className="input" />
          <input name="venue" placeholder="会場" className="input" />
          <input name="event_date" type="date" className="input" title="開催初日" />
          <input name="days" type="number" placeholder="日数" defaultValue={1} className="input" />
          <select name="theme_fit" defaultValue="mid" className="input" title="テーマ相性"><option value="high">相性:高</option><option value="mid">相性:中</option><option value="low">相性:低</option></select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="has_seminar" value="1" className="accent-teal-primary" /> セミナー枠あり</label>
          <input name="expected_visitors" type="number" placeholder="集客数(来場)" className="input" />
          <input name="expected_leads" type="number" placeholder="想定リード数" className="input" />
          <input name="booth_cost" type="number" placeholder="出展料(円)" className="input" />
          <input name="staff_cost" type="number" placeholder="スタッフ費用(円)" className="input" />
          <input name="other_cost" type="number" placeholder="その他費用(円)" className="input" />
          <input name="expected_revenue" type="number" placeholder="想定売上(円)" className="input" />
          <select name="status" defaultValue="considering" className="input">{EXH_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <input name="notes" placeholder="メモ" className="input md:col-span-2" />
          <SubmitButton className="btn-primary md:col-span-2" pendingLabel="保存中…">候補を登録</SubmitButton>
        </form>
      </Section>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th text-center">ランク</th><th className="th text-right">スコア</th><th className="th">展示会</th>
              <th className="th whitespace-nowrap">開催日</th><th className="th text-center">相性</th><th className="th text-right">想定リード</th>
              <th className="th text-right">合計費用</th><th className="th text-right">CPL</th><th className="th text-right">想定売上</th><th className="th text-right">ROI</th>
              <th className="th">出展判断</th><th className="th">最終決定</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((r) => {
              const dec = EXH_DECISION.find((d) => d.key === r.decision);
              return (
                <tr key={r.id} className={cn("row-hover align-top", r.decision === "approved" && "bg-teal-light/15", r.decision === "rejected" && "opacity-50")}>
                  <td className="td text-center"><span className={cn("pill text-[11px] font-bold", EXH_RANK_COLOR[r.score.rank])}>{r.score.rank}</span></td>
                  <td className="td text-right tabular-nums font-semibold">{r.score.total}</td>
                  <td className="td max-w-[220px]">
                    <details>
                      <summary className="cursor-pointer font-medium">{r.name}<span className="text-xs text-ink/45 ml-1">{r.organizer}</span></summary>
                      {r.score.reasons.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.score.reasons.map((x) => <span key={x} className="pill bg-mist-soft text-ink/55 text-[10px]">{x}</span>)}</div>}
                      <form action={saveExhibitionCandidateAction} className="mt-2 grid grid-cols-2 gap-2 border-t border-black/[0.05] pt-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="name" defaultValue={r.name} className="input text-xs" />
                        <input name="organizer" defaultValue={r.organizer ?? ""} placeholder="運営元" className="input text-xs" />
                        <input name="venue" defaultValue={r.venue ?? ""} placeholder="会場" className="input text-xs" />
                        <input name="event_date" type="date" defaultValue={r.event_date ?? ""} className="input text-xs" />
                        <select name="theme_fit" defaultValue={r.theme_fit} className="input text-xs">{THEME_FIT.map((t) => <option key={t.key} value={t.key}>相性:{t.label}</option>)}</select>
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="has_seminar" value="1" defaultChecked={r.has_seminar} className="accent-teal-primary" />セミナー</label>
                        <input name="expected_visitors" type="number" defaultValue={r.expected_visitors ?? ""} placeholder="集客" className="input text-xs" />
                        <input name="expected_leads" type="number" defaultValue={r.expected_leads ?? ""} placeholder="想定リード" className="input text-xs" />
                        <input name="booth_cost" type="number" defaultValue={r.booth_cost ?? ""} placeholder="出展料" className="input text-xs" />
                        <input name="staff_cost" type="number" defaultValue={r.staff_cost ?? ""} placeholder="スタッフ費" className="input text-xs" />
                        <input name="other_cost" type="number" defaultValue={r.other_cost ?? ""} placeholder="その他費" className="input text-xs" />
                        <input name="expected_revenue" type="number" defaultValue={r.expected_revenue ?? ""} placeholder="想定売上" className="input text-xs" />
                        <input type="hidden" name="status" value={r.status} />
                        <SubmitButton className="btn-accent text-xs col-span-2" pendingLabel="保存中…">保存</SubmitButton>
                      </form>
                      <form action={deleteExhibitionCandidateAction} className="mt-1"><input type="hidden" name="id" value={r.id} /><button className="text-[11px] text-rose-400 hover:text-rose-600">削除</button></form>
                    </details>
                  </td>
                  <td className="td text-xs whitespace-nowrap">{formatDateFull(r.event_date)}{r.score.tightDays != null && r.score.tightDays <= 14 && <span className="block text-rose-500">日程{r.score.tightDays}日差</span>}</td>
                  <td className="td text-center text-xs">{THEME_FIT.find((t) => t.key === r.theme_fit)?.label ?? "—"}{r.has_seminar && <span className="block text-teal-deep text-[10px]">ｾﾐﾅｰ</span>}</td>
                  <td className="td text-right tabular-nums">{(r.expected_leads ?? 0).toLocaleString()}</td>
                  <td className="td text-right tabular-nums text-xs">{formatYen(r.score.cost)}</td>
                  <td className="td text-right tabular-nums text-xs">{r.score.cpl != null ? formatYen(r.score.cpl) : "—"}</td>
                  <td className="td text-right tabular-nums text-xs">{formatYen(r.revenue)}</td>
                  <td className="td text-right tabular-nums text-xs">{pctRoi(r.score.roi)}</td>
                  <td className="td">
                    <form action={setExhibitionStatusAction}><input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue={r.status} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="rounded-lg border border-black/10 bg-white px-1.5 py-1 text-xs">{EXH_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                    </form>
                  </td>
                  <td className="td">
                    <form action={setExhibitionDecisionAction}><input type="hidden" name="id" value={r.id} />
                      <select name="decision" defaultValue={r.decision} onChange={(e) => e.currentTarget.form?.requestSubmit()} className={cn("rounded-lg border border-black/10 px-1.5 py-1 text-xs", dec?.color ?? "bg-white")}>{EXH_DECISION.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={12} className="td text-center text-ink/40 py-8">候補が未登録です。上のフォームから登録してください。</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/40 mt-3">※ スコア＝想定リード規模＋テーマ相性＋ROI＋リード単価＋セミナー＋集客規模 −日程の詰まり。ランク S≥70/A≥55/B≥40/C≥25。配点は調整可能です。最終決定(出展承認)は幹部が行います。</p>
      <p className="text-xs text-ink/40">出展判断: {EXH_STATUS.map((s) => EXH_STATUS_LABEL[s.key]).join(" / ")}。最終決定: {EXH_DECISION.map((d) => EXH_DECISION_LABEL[d.key]).join(" / ")}。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
