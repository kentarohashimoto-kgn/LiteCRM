import Link from "next/link";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createFuCaseAction, updateFuCaseAction, updateFuMeetingAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const SCHED = [
  { key: "not_scheduled", label: "未調整" },
  { key: "scheduled", label: "調整済" },
  { key: "done", label: "実施済" },
  { key: "skipped", label: "見送り" },
];
const UPSELL = [
  { key: "none", label: "なし" },
  { key: "proposed", label: "提案中" },
  { key: "won", label: "受注" },
];
const VIEWS = [
  { key: "list", label: "一覧" },
  { key: "calendar", label: "カレンダー" },
  { key: "wbs", label: "WBS" },
];

interface FuCase {
  id: string; account_name: string; training_name: string | null; won_date: string; status: string;
  assignee_user_id: string | null; notes: string | null;
}
interface FuMtg {
  id: string; case_id: string; round_months: number; due_date: string; schedule_status: string;
  held_on: string | null; ai_score: number | null; issues: string | null; proposal_done: boolean;
  upsell_status: string; notes: string | null;
}
interface Member { id: string; name: string; }

/** Mtgの状態色: 実施済=緑 / 超過=赤 / 調整済=黄 / 未調整=灰 / 見送り=薄灰。 */
function mtgTone(m: FuMtg, today: string): string {
  if (m.schedule_status === "done") return "bg-teal-light text-teal-deep";
  if (m.schedule_status === "skipped") return "bg-black/[0.04] text-ink/35 line-through";
  if (m.due_date < today) return "bg-rose-50 text-rose-600";
  if (m.schedule_status === "scheduled") return "bg-amber-50 text-amber-700";
  return "bg-black/[0.05] text-ink/60";
}

function monthAdd(ym: string, diff: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + diff, 1));
  return d.toISOString().slice(0, 7);
}

/** BO-6 研修後フォローアップ: 受注研修を母数に1/3/6ヶ月後Mtgと活用度・アップセルを追跡。 */
export default async function FollowupsPage(
  props: { searchParams: Promise<{ view?: string; assignee?: string; month?: string }> }
) {
  const searchParams = await props.searchParams;
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const view = ["calendar", "wbs"].includes(searchParams.view ?? "") ? (searchParams.view as string) : "list";
  const assignee = searchParams.assignee || "all";

  const [casesR, mtgR, profilesR] = await Promise.all([
    sb.from("fu_cases").select("id, account_name, training_name, won_date, status, assignee_user_id, notes").order("won_date", { ascending: false }).limit(300),
    sb.from("fu_meetings").select("id, case_id, round_months, due_date, schedule_status, held_on, ai_score, issues, proposal_done, upsell_status, notes").order("round_months").limit(1000),
    sb.from("profiles").select("id, display_name, email"),
  ]);
  const allCases = (casesR.data ?? []) as FuCase[];
  const members: Member[] = (profilesR.data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) || (p.email as string) || "—" }));
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  // 担当で絞り込み(all / none=未割当 / ユーザーID)
  const cases = allCases.filter((c) =>
    assignee === "all" ? true : assignee === "none" ? !c.assignee_user_id : c.assignee_user_id === assignee,
  );
  const caseIds = new Set(cases.map((c) => c.id));
  const mtgs = ((mtgR.data ?? []) as FuMtg[]).filter((m) => caseIds.has(m.case_id));
  const byCase = new Map<string, FuMtg[]>();
  for (const m of mtgs) (byCase.get(m.case_id) ?? byCase.set(m.case_id, []).get(m.case_id)!).push(m);
  const caseOf = new Map(cases.map((c) => [c.id, c]));

  const open = cases.filter((c) => c.status === "open");
  const openIds = new Set(open.map((c) => c.id));
  const activeMtgs = mtgs.filter((m) => openIds.has(m.case_id) && m.schedule_status !== "skipped");
  const doneMtgs = activeMtgs.filter((m) => m.schedule_status === "done");
  const overdue = activeMtgs.filter((m) => m.schedule_status !== "done" && m.due_date < today);
  const upsellWon = mtgs.filter((m) => m.upsell_status === "won").length;
  const upsellProposed = mtgs.filter((m) => m.upsell_status === "proposed").length;

  const qs = (v: string, extra?: string) => `/app/bo/followups?view=${v}&assignee=${assignee}${extra ?? ""}`;

  // カレンダー用: 表示月と日別Mtg
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? (searchParams.month as string) : today.slice(0, 7);
  const [cy, cm] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const mtgsByDate = new Map<string, FuMtg[]>();
  for (const m of mtgs) (mtgsByDate.get(m.due_date) ?? mtgsByDate.set(m.due_date, []).get(m.due_date)!).push(m);

  // WBS用: 期日が存在する月の範囲(横スクロール)
  const monthKeys = mtgs.map((m) => m.due_date.slice(0, 7));
  const wbsStart = monthKeys.length ? monthKeys.reduce((a, b) => (a < b ? a : b)) : today.slice(0, 7);
  const wbsEnd = monthKeys.length ? monthKeys.reduce((a, b) => (a > b ? a : b)) : today.slice(0, 7);
  const wbsMonths: string[] = [];
  for (let k = wbsStart; k <= wbsEnd && wbsMonths.length < 30; k = monthAdd(k, 1)) wbsMonths.push(k);

  return (
    <div className={view === "list" ? "max-w-5xl" : ""}>
      <PageHeader title="研修後フォローアップ" subtitle="受注した研修案件を母数に、1・3・6ヶ月後のフォローMtgの日程調整・実施と、AI活用度の進化・業務課題・提案・アップセルを追跡します。受注が発生すると自動で追加されます。" />

      {/* 表示切替＋担当絞り込み */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex rounded-lg border border-black/10 overflow-hidden">
          {VIEWS.map((v) => (
            <Link key={v.key} href={qs(v.key)} className={`px-3 py-1.5 text-xs ${view === v.key ? "bg-teal-deep text-white" : "bg-white text-ink/60 hover:bg-black/[0.03]"}`}>
              {v.label}
            </Link>
          ))}
        </div>
        <form method="get" action="/app/bo/followups" className="flex items-center gap-1.5">
          <input type="hidden" name="view" value={view} />
          <label className="text-xs text-ink/50">担当</label>
          <select name="assignee" defaultValue={assignee} className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs">
            <option value="all">全員</option>
            <option value="none">未割当</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-black/[0.03]">絞り込む</button>
          {assignee !== "all" && <Link href={qs(view).replace(`assignee=${assignee}`, "assignee=all")} className="text-xs text-teal-deep hover:underline">解除</Link>}
        </form>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">対象(進行中)</div><div className="stat-value mt-1">{open.length}<span className="stat-unit">社</span></div></Card>
        <Card><div className="text-xs text-ink/50">実施済みMtg</div><div className="stat-value mt-1">{doneMtgs.length}<span className="stat-unit">/{activeMtgs.length}</span></div></Card>
        <Card><div className="text-xs text-ink/50">期日超過(未実施)</div><div className={`stat-value mt-1 ${overdue.length ? "text-rose-600" : ""}`}>{overdue.length}</div></Card>
        <Card><div className="text-xs text-ink/50">アップセル提案中</div><div className="stat-value mt-1">{upsellProposed}</div></Card>
        <Card><div className="text-xs text-ink/50">アップセル受注</div><div className={`stat-value mt-1 ${upsellWon ? "text-teal-deep" : ""}`}>{upsellWon}</div></Card>
      </div>

      {view === "calendar" && (
        <Section title="カレンダー（期日ベース）" className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Link href={qs("calendar", `&month=${monthAdd(month, -1)}`)} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">← 前月</Link>
            <span className="font-medium text-sm tabular-nums">{cy}年{cm}月</span>
            <Link href={qs("calendar", `&month=${monthAdd(month, 1)}`)} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">翌月 →</Link>
            {month !== today.slice(0, 7) && <Link href={qs("calendar")} className="text-xs text-teal-deep hover:underline">今月へ</Link>}
            <span className="ml-auto text-xs text-ink/40">緑=実施済 / 赤=超過 / 黄=調整済 / 灰=未調整</span>
          </div>
          <div className="grid grid-cols-7 gap-px bg-black/[0.06] rounded-xl overflow-hidden border border-black/[0.06]">
            {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
              <div key={d} className={`bg-white px-2 py-1.5 text-xs font-medium text-center ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-ink/50"}`}>{d}</div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} className="bg-white min-h-[84px]" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              const items = mtgsByDate.get(date) ?? [];
              return (
                <div key={date} className={`bg-white min-h-[84px] p-1 ${date === today ? "ring-2 ring-inset ring-teal-primary/50" : ""}`}>
                  <div className={`text-[11px] tabular-nums ${date === today ? "font-bold text-teal-deep" : "text-ink/45"}`}>{day}</div>
                  <div className="space-y-0.5 mt-0.5">
                    {items.slice(0, 4).map((m) => {
                      const c = caseOf.get(m.case_id);
                      return (
                        <div key={m.id} className={`rounded px-1 py-0.5 text-[10px] leading-tight truncate ${mtgTone(m, today)}`} title={`${c?.account_name} ${m.round_months}ヶ月後Mtg（担当: ${c?.assignee_user_id ? nameOf.get(c.assignee_user_id) ?? "—" : "未割当"}）`}>
                          {m.round_months}ヶ月 {c?.account_name ?? ""}
                        </div>
                      );
                    })}
                    {items.length > 4 && <div className="text-[10px] text-ink/40 px-1">他{items.length - 4}件</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {view === "wbs" && (
        <Section title="横長WBS（社×月のタイムライン）" className="mb-5">
          <div className="flex items-center gap-2 mb-2 text-xs text-ink/40">
            <span>数字=何ヶ月後Mtg</span>
            <span className="ml-auto">緑=実施済 / 赤=超過 / 黄=調整済 / 灰=未調整</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 font-medium text-ink/50 border-b border-black/[0.06] min-w-[200px]">会社（担当）</th>
                  {wbsMonths.map((mk) => (
                    <th key={mk} className={`px-2 py-2 font-medium tabular-nums border-b border-l border-black/[0.05] whitespace-nowrap ${mk === today.slice(0, 7) ? "bg-teal-light/60 text-teal-deep" : "text-ink/45 bg-white"}`}>
                      {mk.slice(2).replace("-", "/")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const rows = byCase.get(c.id) ?? [];
                  const byMonth = new Map<string, FuMtg[]>();
                  for (const m of rows) (byMonth.get(m.due_date.slice(0, 7)) ?? byMonth.set(m.due_date.slice(0, 7), []).get(m.due_date.slice(0, 7))!).push(m);
                  return (
                    <tr key={c.id} className={c.status !== "open" ? "opacity-45" : ""}>
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-black/[0.04] min-w-[200px]">
                        <span className="font-medium text-ink block truncate max-w-[220px]">{c.account_name}</span>
                        <span className="text-[10px] text-ink/40">{c.assignee_user_id ? nameOf.get(c.assignee_user_id) ?? "—" : "未割当"}｜受注 {c.won_date}</span>
                      </td>
                      {wbsMonths.map((mk) => (
                        <td key={mk} className={`px-1.5 py-1.5 border-b border-l border-black/[0.04] text-center whitespace-nowrap ${mk === today.slice(0, 7) ? "bg-teal-light/25" : ""}`}>
                          {(byMonth.get(mk) ?? []).map((m) => (
                            <span key={m.id} className={`inline-block rounded-md px-1.5 py-0.5 font-semibold tabular-nums mx-0.5 ${mtgTone(m, today)}`} title={`${m.round_months}ヶ月後Mtg 期日 ${m.due_date}（${SCHED.find((s) => s.key === m.schedule_status)?.label}）`}>
                              {m.round_months}
                            </span>
                          ))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {view === "list" && (
        <>
          <Section title="対象を手動追加（受注案件は自動で追加されます）" className="mb-5">
            <form action={createFuCaseAction} className="flex items-end gap-2.5 flex-wrap">
              <div><label className="label">会社名 *</label><input name="account_name" required className="input" /></div>
              <div><label className="label">研修名</label><input name="training_name" className="input" /></div>
              <div><label className="label">基準日(受注日)</label><input name="won_date" type="date" className="input w-auto" /></div>
              <SubmitButton className="btn-accent" pendingLabel="保存中…">追加（1/3/6ヶ月後Mtgを自動生成）</SubmitButton>
            </form>
          </Section>

          <Section title={`フォローアップ一覧（${cases.length}）`}>
            {cases.length === 0 ? (
              <p className="text-sm text-ink/40 py-6 text-center">対象がありません</p>
            ) : (
              <ul className="space-y-3">
                {cases.map((c) => {
                  const rows = byCase.get(c.id) ?? [];
                  const scores = rows.filter((m) => m.ai_score != null).map((m) => `${m.round_months}ヶ月:${m.ai_score}点`);
                  return (
                    <li key={c.id} className={`rounded-xl border border-black/[0.05] p-3 ${c.status !== "open" ? "opacity-55" : ""}`}>
                      <div className="flex items-center gap-2.5 flex-wrap text-sm mb-2">
                        <span className="font-medium text-ink">{c.account_name}</span>
                        {c.training_name && <span className="text-xs text-ink/45">{c.training_name}</span>}
                        <span className="text-xs text-ink/40 tabular-nums">受注 {c.won_date}</span>
                        {scores.length > 0 && <span className="pill bg-teal-light text-teal-deep text-xs">AI活用度 {scores.join(" → ")}</span>}
                        <form action={updateFuCaseAction} className="flex items-center gap-1.5 ml-auto">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="op" value="assign" />
                          <label className="text-xs text-ink/45">担当</label>
                          <select name="assignee_user_id" defaultValue={c.assignee_user_id ?? ""} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs">
                            <option value="">未割当</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <SubmitButton className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">変更</SubmitButton>
                        </form>
                        <form action={updateFuCaseAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="id" value={c.id} />
                          {c.status === "open" ? (
                            <>
                              <button name="op" value="done" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">完了</button>
                              <button name="op" value="skipped" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">対象外</button>
                            </>
                          ) : (
                            <button name="op" value="open" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">再開</button>
                          )}
                          <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                        </form>
                      </div>

                      <div className="space-y-2">
                        {rows.map((m) => {
                          const late = m.schedule_status !== "done" && m.schedule_status !== "skipped" && m.due_date < today && c.status === "open";
                          return (
                            <form key={m.id} action={updateFuMeetingAction} className={`rounded-lg border p-2 ${late ? "border-rose-200 bg-rose-50/40" : "border-black/[0.04]"}`}>
                              <input type="hidden" name="id" value={m.id} />
                              <div className="flex items-end gap-2 flex-wrap">
                                <span className={`pill shrink-0 text-xs ${mtgTone(m, today)}`}>
                                  {m.round_months}ヶ月後{late && " 超過"}
                                </span>
                                <div><label className="label">期日</label><input name="due_date" type="date" defaultValue={m.due_date} className="input w-auto text-xs py-1" /></div>
                                <div>
                                  <label className="label">日程調整</label>
                                  <select name="schedule_status" defaultValue={m.schedule_status} className="input w-auto text-xs py-1">
                                    {SCHED.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                  </select>
                                </div>
                                <div><label className="label">実施日</label><input name="held_on" type="date" defaultValue={m.held_on ?? ""} className="input w-auto text-xs py-1" /></div>
                                <div><label className="label">AI活用度(点)</label><input name="ai_score" type="number" min={0} max={100} defaultValue={m.ai_score ?? ""} className="input w-20 text-xs py-1" /></div>
                                <label className="flex items-center gap-1.5 text-xs text-ink/70 pb-1.5">
                                  <input type="checkbox" name="proposal_done" defaultChecked={m.proposal_done} className="accent-teal-600" />
                                  ソリューション提案済
                                </label>
                                <div>
                                  <label className="label">アップセル</label>
                                  <select name="upsell_status" defaultValue={m.upsell_status} className="input w-auto text-xs py-1">
                                    {UPSELL.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                                  </select>
                                </div>
                                <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                                <input name="issues" defaultValue={m.issues ?? ""} className="input flex-1 min-w-[220px] text-xs py-1" placeholder="他の業務課題（ここからソリューション提案につなげる）" />
                                <input name="notes" defaultValue={m.notes ?? ""} className="input flex-1 min-w-[160px] text-xs py-1" placeholder="メモ" />
                              </div>
                            </form>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
