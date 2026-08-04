import { Fragment } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { requireProjectCtx } from "@/lib/session";
import { getMonthlyTalentBilling } from "@/lib/data/talents";
import { todayJST, monthEndOf, formatHoursHM } from "@/lib/work-time";
import { formatYen } from "@/lib/utils";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { TalentBillingCsv } from "@/components/work/talent-billing-csv";
import {
  AFFILIATION_LABEL,
  affiliationLabelOf,
  billingTotals,
  isCurrentTalent,
  matchesAffiliation,
  matchesQuery,
  sortRoster,
  type RosterSort,
} from "@/lib/talent-billing";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { external: "外部委託", internal: "社員", general: "全般稼働" };
const EMP_LABEL: Record<string, string> = { employee: "社員", contractor: "業務委託", instructor: "講師", company: "企業・代理店" };
const SORTS: { key: RosterSort; label: string }[] = [
  { key: "affiliation", label: "所属順" },
  { key: "name", label: "氏名順" },
  { key: "department", label: "部署順" },
  { key: "status", label: "契約ステータス順" },
  { key: "rate", label: "時給が高い順" },
];

function normMonthParam(v: string | undefined, fallback: string): string {
  const m = (v ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : fallback;
}
function addMonths(monthStart: string, n: number): string {
  const d = new Date(monthStart + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

const AFF_PILL: Record<string, string> = {
  company: "bg-teal-light text-teal-deep",
  individual: "bg-violet-50 text-violet-700",
  unset: "bg-rose-50 text-rose-600",
};

/**
 * 月次の担当者・請求・稼働サマリー。
 *  1. 担当者一覧(所属でのソート・フィルター)
 *  2. 請求サマリー(所属会社ごとに月末いくら請求が来るか)
 *  3. 稼働実績一覧(担当者ごとの工数・金額を所属会社でグルーピング)
 */
export default async function TalentBillingPage(
  props: {
    searchParams: Promise<{ month?: string; aff?: string; sort?: RosterSort; q?: string; scope?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireProjectCtx();
  const today = todayJST();
  const month = normMonthParam(searchParams.month, `${today.slice(0, 7)}-01`);
  const monthEnd = monthEndOf(month);
  const monthLabel = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;

  const { rows, groups, companies, companyById, talents } = await getMonthlyTalentBilling(month, monthEnd);
  const totals = billingTotals(groups);

  const aff = searchParams.aff ?? "all";
  const q = searchParams.q ?? "";
  const sort: RosterSort = SORTS.some((s) => s.key === searchParams.sort) ? (searchParams.sort as RosterSort) : "affiliation";
  const scope = searchParams.scope === "all" ? "all" : "current";

  const current = talents.filter(isCurrentTalent);
  const unsetCount = current.filter((t) => t.affiliation_type === "unset").length;
  const roster = sortRoster(
    (scope === "current" ? current : talents).filter((t) => matchesAffiliation(t, aff)).filter((t) => matchesQuery(t, q, companyById)),
    sort,
    companyById,
  );
  // 担当者一覧に当月の実績を並べるための索引
  const workByTalent = new Map(rows.filter((r) => r.talentId).map((r) => [r.talentId as string, r]));
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ month: month.slice(0, 7), aff, sort, scope, ...(q ? { q } : {}), ...extra });
    return `/app/projects/billing?${p.toString()}`;
  };

  const monthNav = (
    <div className="flex items-center gap-1.5 text-sm">
      <Link href={qs({ month: addMonths(month, -1).slice(0, 7) })} className="btn-ghost px-2 py-1" aria-label="前の月"><ChevronLeft size={15} /></Link>
      <span className="font-semibold text-ink/80 tabular-nums">{monthLabel}</span>
      <Link href={qs({ month: addMonths(month, 1).slice(0, 7) })} className="btn-ghost px-2 py-1" aria-label="次の月"><ChevronRight size={15} /></Link>
      <Link href="/app/projects/billing" className="btn-ghost text-xs">今月へ</Link>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="担当者・請求・稼働サマリー"
        subtitle="担当者の所属会社ごとに、その月いくら請求が来るか／誰が何時間いくら分稼働したかを月次で確認します。金額は承認済みの稼働実績 × 単価です。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <TalentBillingCsv groups={groups} monthLabel={month.slice(0, 7)} />
            <Link href="/app/projects/approvals" className="btn-ghost text-xs">稼働承認へ</Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">請求元</div><div className="stat-value mt-1">{groups.filter((g) => g.party.type !== "unset").length}<span className="stat-unit">件</span></div></Card>
        <Card><div className="text-xs text-ink/50">承認済み工数（{monthLabel}）</div><div className="stat-value mt-1 tabular-nums">{formatHoursHM(totals.approvedHours)}</div></Card>
        <Card><div className="text-xs text-ink/50">請求額 合計（税抜）</div><div className="stat-value mt-1 tabular-nums">{formatYen(totals.subtotal)}</div></Card>
        <Card><div className="text-xs text-ink/50">請求額 合計（税込）</div><div className="stat-value mt-1 tabular-nums stat-accent">{formatYen(totals.total)}</div></Card>
        <Card>
          <div className="text-xs text-ink/50">承認待ち（未計上）</div>
          <div className={`stat-value mt-1 tabular-nums ${totals.pendingHours ? "text-amber-700" : ""}`}>{formatHoursHM(totals.pendingHours)}</div>
        </Card>
      </div>

      {unsetCount > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <span>
            所属が未設定の担当者が <b>{unsetCount}名</b> います。請求元が確定しないため、下の請求サマリーでは「所属未設定」として切り出しています。
            <Link href="/app/hr/talents?aff=unset&scope=all" className="ml-1.5 font-semibold underline">タレント台帳で所属を設定</Link>
          </span>
        </div>
      )}

      {/* ---- 1. 担当者一覧 ---- */}
      <Section title={`担当者一覧（${roster.length}／現在 ${current.length}名）`} className="mb-6" action={monthNav}>
        <form method="get" action="/app/projects/billing" className="mb-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="month" value={month.slice(0, 7)} />
          <div>
            <label className="label">所属で絞り込み</label>
            <select name="aff" defaultValue={aff} className="input w-auto text-sm">
              <option value="all">すべての所属</option>
              <option value="company">会社所属（すべて）</option>
              <option value="individual">個人（個人事業主）</option>
              <option value="unset">所属未設定</option>
              {companies.length > 0 && (
                <optgroup label="会社を指定">
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className="label">並び順</label>
            <select name="sort" defaultValue={sort} className="input w-auto text-sm">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">対象</label>
            <select name="scope" defaultValue={scope} className="input w-auto text-sm">
              <option value="current">現在の担当者のみ</option>
              <option value="all">解約・終了も含む</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label">検索（氏名・所属・部署・役割）</label>
            <input name="q" defaultValue={q} className="input text-sm" placeholder="キーワード" />
          </div>
          <button type="submit" className="btn-primary text-sm">絞り込む</button>
          {(aff !== "all" || q || sort !== "affiliation" || scope !== "current") && (
            <Link href={`/app/projects/billing?month=${month.slice(0, 7)}`} className="text-xs text-teal-deep hover:underline pb-2">条件をクリア</Link>
          )}
        </form>

        {roster.length === 0 ? (
          <div className="py-10 text-center">
            <Users size={26} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">条件に一致する担当者がいません。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 900 }}>
              <thead className="text-ink/40 text-xs bg-mist-soft/30">
                <tr>
                  <th className="th">担当者</th><th className="th">所属（請求元）</th><th className="th">区分</th>
                  <th className="th">部署・役割</th><th className="th">契約</th><th className="th text-right">時給</th>
                  <th className="th text-right">{Number(month.slice(5, 7))}月 承認済み</th><th className="th text-right">金額（税抜）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {roster.map((t) => {
                  const w = workByTalent.get(t.id);
                  return (
                    <tr key={t.id} className="row-hover">
                      <td className="td font-medium text-ink/85">
                        {t.name}
                        {!t.cost_managed && <span className="pill bg-violet-50 text-violet-700 text-[10px] ml-1.5" title="成功報酬など、原価管理の対象外">原価対象外</span>}
                        {!t.user_id && t.work_report_required && <span className="pill bg-amber-50 text-amber-700 text-[10px] ml-1.5" title="CRMアカウント未紐付けのため本人が稼働報告を記入できません">未紐付け</span>}
                      </td>
                      <td className="td">
                        <span className={`pill text-[10px] font-bold ${AFF_PILL[t.affiliation_type]}`}>{affiliationLabelOf(t, companyById)}</span>
                      </td>
                      <td className="td text-xs text-ink/60">{EMP_LABEL[t.employment_type] ?? t.employment_type}</td>
                      <td className="td text-xs text-ink/60">{[t.department, t.role_text].filter(Boolean).join("・") || "—"}</td>
                      <td className="td text-xs text-ink/60">{t.contract_status}</td>
                      <td className="td text-right tabular-nums text-xs text-ink/60">{t.hourly_rate != null ? `${formatYen(Number(t.hourly_rate))}/時` : "—"}</td>
                      <td className="td text-right tabular-nums font-semibold">{w ? formatHoursHM(w.approvedHours) : "—"}</td>
                      <td className="td text-right tabular-nums font-semibold">{w ? formatYen(Math.round(w.amount)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---- 2. 請求サマリー ---- */}
      <Section title={`請求サマリー（所属会社ごと） — ${monthLabel}`} className="mb-6" action={monthNav}>
        {groups.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">この月の承認済み稼働はまだありません。</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums" style={{ minWidth: 880 }}>
                <thead className="text-ink/40 text-xs bg-mist-soft/30">
                  <tr>
                    <th className="th">請求元</th><th className="th">所属区分</th><th className="th text-right">人数</th>
                    <th className="th text-right">承認済み工数</th><th className="th text-right">承認待ち</th>
                    <th className="th text-right">小計（税抜）</th><th className="th text-right">消費税</th><th className="th text-right">請求額（税込）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {groups.map((g) => (
                    <tr key={g.party.key} className={`row-hover ${g.party.type === "unset" ? "bg-rose-50/40" : ""}`}>
                      <td className="td font-medium text-ink/85">
                        {g.party.name}
                        {g.party.invoiceNo && <span className="text-[10px] text-ink/40 ml-1.5">{g.party.invoiceNo}</span>}
                        {g.party.paymentTerms && <div className="text-[11px] text-ink/45">{g.party.paymentTerms}</div>}
                      </td>
                      <td className="td"><span className={`pill text-[10px] font-bold ${AFF_PILL[g.party.type]}`}>{AFFILIATION_LABEL[g.party.type]}</span></td>
                      <td className="td text-right text-ink/70">{g.members.length}</td>
                      <td className="td text-right font-semibold">{formatHoursHM(g.approvedHours)}</td>
                      <td className="td text-right text-amber-700">{g.pendingHours ? formatHoursHM(g.pendingHours) : "—"}</td>
                      <td className="td text-right">{formatYen(g.subtotal)}</td>
                      <td className="td text-right text-ink/60">{g.party.type === "unset" ? "—" : `${formatYen(g.tax)}（${Number(g.party.taxRate)}%）`}</td>
                      <td className="td text-right font-bold text-ink/90">{g.party.type === "unset" ? "—" : formatYen(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-black/[0.08] font-bold">
                    <td className="td" colSpan={3}>合計</td>
                    <td className="td text-right">{formatHoursHM(totals.approvedHours)}</td>
                    <td className="td text-right text-amber-700">{totals.pendingHours ? formatHoursHM(totals.pendingHours) : "—"}</td>
                    <td className="td text-right">{formatYen(totals.subtotal)}</td>
                    <td className="td text-right">{formatYen(totals.tax)}</td>
                    <td className="td text-right stat-accent">{formatYen(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-ink/40 mt-2">
              金額は「承認済み工数 × 原価単価」（人月単価は月基準時間で時間割り、全般稼働は台帳の時給）。消費税は所属会社マスタの税率、個人事業主は台帳の税率（未設定は10%）で計算しています。
              承認待ちの実績は金額に含みません（承認後に反映されます）。
            </p>
          </>
        )}
      </Section>

      {/* ---- 3. 稼働実績一覧（所属会社でグルーピング） ---- */}
      <Section title={`稼働実績一覧（所属会社でグルーピング） — ${monthLabel}`} action={monthNav}>
        {groups.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">この月の稼働実績はまだありません。</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.party.key} className="rounded-xl border border-black/[0.06] overflow-hidden">
                <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${g.party.type === "unset" ? "bg-rose-50/50" : "bg-mist-soft/40"}`}>
                  <span className="font-bold text-ink/90 text-sm">{g.party.name}</span>
                  <span className={`pill text-[10px] font-bold ${AFF_PILL[g.party.type]}`}>{AFFILIATION_LABEL[g.party.type]}</span>
                  <span className="text-xs text-ink/50">{g.members.length}名</span>
                  <span className="ml-auto text-sm tabular-nums text-ink/75">
                    合計 <b>{formatHoursHM(g.approvedHours)}</b>
                    <span className="ml-3">{formatYen(g.subtotal)}<span className="text-xs text-ink/45">（税抜）</span></span>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums" style={{ minWidth: 880 }}>
                    <thead className="text-ink/40 text-xs">
                      <tr>
                        <th className="th">担当者</th><th className="th">稼働先（案件）</th><th className="th">区分</th>
                        <th className="th text-right">予定工数</th><th className="th text-right">承認済み</th>
                        <th className="th text-right">承認待ち</th><th className="th text-right">金額（税抜）</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04]">
                      {g.members.map((m) => (
                        <Fragment key={m.talentId ?? m.details[0]?.key ?? m.talentName}>
                          {m.details.map((d, i) => (
                            <tr key={d.key} className="row-hover">
                              <td className="td">
                                {i === 0 ? (
                                  <span className="font-medium text-ink/85">
                                    {m.talentName}
                                    {!m.talentId && <span className="pill bg-amber-50 text-amber-700 text-[10px] ml-1.5" title="タレント台帳に登録がないため所属を解決できません">台帳未登録</span>}
                                  </span>
                                ) : (
                                  <span className="text-ink/25 text-xs">〃</span>
                                )}
                              </td>
                              <td className="td text-xs text-ink/70">{d.kind === "general" ? d.oppName : `${d.accountName}｜${d.oppName}`}</td>
                              <td className="td"><span className="pill bg-mist-soft text-ink/50 text-[10px]">{KIND[d.kind] ?? d.kind}</span></td>
                              <td className="td text-right text-ink/60">{d.plannedHours ? formatHoursHM(d.plannedHours) : "—"}</td>
                              <td className="td text-right font-semibold">{formatHoursHM(d.approvedHours)}</td>
                              <td className="td text-right text-amber-700">{d.pendingHours ? formatHoursHM(d.pendingHours) : "—"}</td>
                              <td className="td text-right font-semibold">{formatYen(Math.round(d.amount))}</td>
                            </tr>
                          ))}
                          {m.details.length > 1 && (
                            <tr key={`${m.talentName}-sub`} className="bg-black/[0.015] text-xs">
                              <td className="td text-ink/50" colSpan={4}>{m.talentName} 小計</td>
                              <td className="td text-right font-bold">{formatHoursHM(m.approvedHours)}</td>
                              <td className="td text-right text-amber-700">{m.pendingHours ? formatHoursHM(m.pendingHours) : "—"}</td>
                              <td className="td text-right font-bold">{formatYen(Math.round(m.amount))}</td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink/40 mt-3">
          担当者ごとに、その月の稼働先（案件アサイン・全般稼働）別の工数と金額を表示しています。所属会社が同じ担当者は1つのグループにまとまり、グループ合計がその会社への月次請求額（税抜）になります。
        </p>
      </Section>
    </div>
  );
}
