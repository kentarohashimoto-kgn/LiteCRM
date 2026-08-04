import Link from "next/link";
import { AlertTriangle, Building2 } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getMembersLite } from "@/lib/data/workspace";
import { getTalentRoster } from "@/lib/data/talents";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createTalentAction, updateTalentAction, addTalentReviewAction } from "@/server/actions/hr";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  affiliationLabelOf,
  isCurrentTalent,
  matchesAffiliation,
  matchesQuery,
  sortRoster,
  type RosterSort,
  type RosterTalent,
} from "@/lib/talent-billing";

export const dynamic = "force-dynamic";

const EMP_LABEL: Record<string, string> = { employee: "社員", contractor: "業務委託", instructor: "講師", company: "企業・代理店" };
const STATUS_OPTIONS = ["継続", "保留", "Ｘジム", "パフォ悪", "ほぼ解約", "解約"];
const STATUS_CLS: Record<string, string> = {
  継続: "bg-emerald-50 text-emerald-700",
  保留: "bg-amber-50 text-amber-700",
  Ｘジム: "bg-teal-light text-teal-deep",
  パフォ悪: "bg-rose-50 text-rose-600",
  ほぼ解約: "bg-ink/5 text-ink/45",
  解約: "bg-ink/5 text-ink/45",
};
const SORTS: { key: RosterSort; label: string }[] = [
  { key: "status", label: "契約ステータス順" },
  { key: "affiliation", label: "所属順" },
  { key: "department", label: "部署順" },
  { key: "name", label: "氏名順" },
  { key: "rate", label: "時給が高い順" },
];

interface Review {
  id: string; talent_id: string; period: string; reviewer: string | null;
  overall: number | null; comment: string | null; goals: string | null;
}

function stars(n: number | null): string {
  return n == null ? "—" : "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
/** 所属セレクトの現在値(1コントロールで会社/個人/未設定を表す)。 */
const affValue = (t: RosterTalent) => (t.affiliation_type === "company" && t.company_id ? t.company_id : t.affiliation_type);

/** BO-5 タレント台帳・稼働中評価: アクティブ人材(社員/業務委託/講師/企業)の台帳・所属会社・契約状態・原価管理対象の管理。 */
export default async function TalentsPage(
  props: {
    searchParams: Promise<{ aff?: string; q?: string; sort?: RosterSort; scope?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [{ talents, companies, companyById }, revR, members] = await Promise.all([
    getTalentRoster(),
    sb.from("talent_reviews").select("id, talent_id, period, reviewer, overall, comment, goals").order("created_at", { ascending: false }).limit(1000),
    getMembersLite(),
  ]);
  const reviews = (revR.data ?? []) as Review[];
  const revByTalent = new Map<string, Review[]>();
  for (const r of reviews) {
    (revByTalent.get(r.talent_id) ?? revByTalent.set(r.talent_id, []).get(r.talent_id)!).push(r);
  }

  const aff = searchParams.aff ?? "all";
  const q = searchParams.q ?? "";
  const sort: RosterSort = SORTS.some((s) => s.key === searchParams.sort) ? (searchParams.sort as RosterSort) : "status";
  const scope = searchParams.scope === "all" ? "all" : "current";

  const active = talents.filter(isCurrentTalent);
  const churned = talents.filter((t) => !isCurrentTalent(t));
  const costManaged = active.filter((t) => t.cost_managed);
  const unsetCount = talents.filter((t) => t.affiliation_type === "unset").length;

  const filtered = (scope === "current" ? active : talents)
    .filter((t) => matchesAffiliation(t, aff))
    .filter((t) => matchesQuery(t, q, companyById));
  const sorted = sortRoster(filtered, sort, companyById);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="タレント台帳・評価"
        subtitle="アクティブ人材（社員・業務委託・講師・企業）の台帳です。所属会社（個人事業主の場合は「個人」）・契約ステータス・時給・原価管理対象フラグを管理し、期ごとの稼働中評価を記録します。"
        action={
          <div className="flex items-center gap-1.5">
            <Link href="/app/hr/companies" className="btn-ghost inline-flex items-center gap-1 text-xs"><Building2 size={13} /> 所属会社マスタ</Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">現在の担当者</div><div className="stat-value mt-1">{active.length}<span className="stat-unit">名</span></div></Card>
        <Card><div className="text-xs text-ink/50">原価管理対象</div><div className="stat-value mt-1">{costManaged.length}<span className="stat-unit">/ {active.length}</span></div></Card>
        <Card>
          <div className="text-xs text-ink/50">所属未設定</div>
          <div className={`stat-value mt-1 ${unsetCount ? "text-rose-600" : ""}`}>{unsetCount}<span className="stat-unit">名</span></div>
        </Card>
        <Card><div className="text-xs text-ink/50">解約・終了</div><div className="stat-value mt-1">{churned.length}</div></Card>
        <Card><div className="text-xs text-ink/50">評価記録</div><div className="stat-value mt-1">{reviews.length}</div></Card>
      </div>

      {unsetCount > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
          <span>
            所属が未設定の担当者が <b>{unsetCount}名</b> います。所属が決まらないと会社ごとの月次請求額を集計できません（請求サマリーでは「所属未設定」として切り出されます）。
            会社所属なら会社名を、個人事業主なら「個人（個人事業主）」を選んでください。
            <Link href="/app/hr/talents?aff=unset&scope=all" className="ml-1.5 font-semibold underline">未設定だけ表示</Link>
          </span>
        </div>
      )}

      <Section title="タレントを追加" className="mb-5">
        <form action={createTalentAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">氏名 *</label><input name="name" required className="input" /></div>
          <div>
            <label className="label">区分</label>
            <select name="employment_type" className="input w-auto" defaultValue="contractor">
              {Object.entries(EMP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">所属 *</label>
            <select name="affiliation" required defaultValue="" className="input w-auto">
              <option value="" disabled>選択してください</option>
              <option value="individual">個人（個人事業主）</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="unset">未定（あとで設定）</option>
            </select>
          </div>
          <div><label className="label">部署</label><input name="department" className="input w-36" placeholder="営業/開発/講師" /></div>
          <div><label className="label">役割</label><input name="role_text" className="input" placeholder="例: 営業、コンサル" /></div>
          <div><label className="label">時給(円)</label><input name="hourly_rate" inputMode="numeric" className="input w-24 text-right" placeholder="5000" /></div>
          <div><label className="label">メール</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">稼働開始日</label><input name="joined_on" type="date" className="input w-auto" /></div>
          <SubmitButton className="btn-accent" pendingLabel="追加中…">追加</SubmitButton>
        </form>
        <p className="text-xs text-ink/40 mt-2">
          ※ 候補者ページで「入社・稼働」にすると自動でここに追加されます（所属は未設定で追加されるので、あとで選んでください）
          {companies.length === 0 && <> ／ 会社所属を選ぶには先に<Link href="/app/hr/companies" className="text-teal-deep hover:underline mx-0.5">所属会社マスタ</Link>に登録してください</>}
        </p>
      </Section>

      {/* 所属での絞り込み・並べ替え */}
      <form method="get" action="/app/hr/talents" className="mb-3 flex flex-wrap items-end gap-2">
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
        {(aff !== "all" || q || sort !== "status" || scope !== "current") && (
          <Link href="/app/hr/talents" className="text-xs text-teal-deep hover:underline pb-2">条件をクリア</Link>
        )}
      </form>

      <Section title={`台帳（${sorted.length}／全${talents.length}名）`}>
        {sorted.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">条件に一致する担当者がいません。</p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((t) => {
              const revs = revByTalent.get(t.id) ?? [];
              const latest = revs[0];
              const inactive = !isCurrentTalent(t);
              const statusCls = STATUS_CLS[t.contract_status] ?? "bg-mist-soft text-ink/55";
              const statusOpts = STATUS_OPTIONS.includes(t.contract_status) ? STATUS_OPTIONS : [t.contract_status, ...STATUS_OPTIONS];
              return (
                <li key={t.id} className={`rounded-xl border border-black/[0.05] p-3 ${inactive ? "opacity-55" : ""}`}>
                  <form action={updateTalentAction} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <div className="flex items-center gap-2.5 flex-wrap text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span
                        className={`pill text-[10px] font-bold ${
                          t.affiliation_type === "company" ? "bg-teal-light text-teal-deep"
                          : t.affiliation_type === "individual" ? "bg-violet-50 text-violet-700"
                          : "bg-rose-50 text-rose-600"
                        }`}
                        title="所属（請求元）"
                      >
                        {affiliationLabelOf(t, companyById)}
                      </span>
                      <span className={`pill ${statusCls} text-[10px] font-bold`}>{t.contract_status}</span>
                      {!t.cost_managed && <span className="pill bg-violet-50 text-violet-700 text-[10px]" title="成功報酬など、原価管理の対象外">原価管理対象外</span>}
                      {t.title && <span className="text-xs text-ink/50">{t.title}</span>}
                      {t.layer && <span className="pill bg-black/[0.04] text-ink/55 text-[10px]">{t.layer}</span>}
                      {t.hourly_rate != null && <span className="text-xs text-ink/60 tabular-nums">{yen(Number(t.hourly_rate))}/時</span>}
                      {t.joined_on && <span className="text-xs text-ink/40 tabular-nums">{t.joined_on}〜{t.left_on ?? ""}</span>}
                      {latest && <span className="text-xs text-amber-600" title={`${latest.period} の総合評価`}>{stars(latest.overall)}</span>}
                      <span className="ml-auto" />
                      <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                      {!t.left_on && <button name="op" value="leave" className="text-xs text-ink/45 hover:underline">退職・終了</button>}
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select name="affiliation" defaultValue={affValue(t)} className="input w-auto text-xs py-1.5" title="所属（請求元）。個人事業主は「個人」を選びます">
                        <option value="unset">所属未設定</option>
                        <option value="individual">個人（個人事業主）</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <label className="inline-flex items-center gap-1 text-xs text-ink/55 whitespace-nowrap" title="個人事業主の消費税率(%)。空欄は10%扱い、免税事業者は0。会社所属の場合は所属会社マスタの税率を使います">
                        税率
                        <input name="tax_rate" defaultValue={t.tax_rate != null ? String(Number(t.tax_rate)) : ""} inputMode="decimal" className="input w-12 text-xs py-1.5 text-right" placeholder="10" />%
                      </label>
                      <select name="employment_type" defaultValue={t.employment_type} className="input w-auto text-xs py-1.5" title="区分">
                        {Object.entries(EMP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select name="contract_status" defaultValue={t.contract_status} className="input w-auto text-xs py-1.5" title="契約ステータス">
                        {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input name="department" defaultValue={t.department ?? ""} className="input w-24 text-xs py-1.5" placeholder="部署" title="部署" />
                      <input name="title" defaultValue={t.title ?? ""} className="input flex-1 min-w-[120px] text-xs py-1.5" placeholder="役職" title="役職" />
                      <input name="layer" defaultValue={t.layer ?? ""} className="input w-24 text-xs py-1.5" placeholder="レイヤー" title="レイヤー(FS/IS/所属先など)" />
                      <input name="hourly_rate" defaultValue={t.hourly_rate != null ? String(Number(t.hourly_rate)) : ""} inputMode="numeric" className="input w-20 text-xs py-1.5 text-right" placeholder="時給" title="時給(円)" />
                      <label className="inline-flex items-center gap-1.5 text-xs text-ink/70 whitespace-nowrap px-1" title="成功報酬など特殊な報酬体系の場合はOFF">
                        <input type="checkbox" name="cost_managed" defaultChecked={t.cost_managed} className="accent-teal-600" /> 原価管理対象
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-ink/70 whitespace-nowrap px-1" title="ONにすると案件アサインがなくても本人の稼働報告に「全般稼働」の記入枠が表示されます（CRMアカウント紐付けが必要）">
                        <input type="checkbox" name="work_report_required" defaultChecked={t.work_report_required} className="accent-teal-600" /> 稼働報告必須
                      </label>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input name="role_text" defaultValue={t.role_text ?? ""} className="input flex-1 min-w-[170px] text-xs py-1.5" placeholder="役割（営業、コンサル、講師 等）" title="役割" />
                      <input name="email" defaultValue={t.email ?? ""} className="input flex-1 min-w-[180px] text-xs py-1.5" placeholder="連絡先メール" title="連絡先メール" />
                      <select
                        name="user_id"
                        defaultValue={t.user_id ?? ""}
                        className="input w-auto text-xs py-1.5"
                        title="CRMログインの紐付け。紐付けると本人が「稼働報告」で自分のアサインに実績を記入できます"
                      >
                        <option value="">CRMアカウント未紐付け</option>
                        {members.map((m) => (
                          <option key={m.user.id} value={m.user.id}>{m.user.name}（{m.user.email}）</option>
                        ))}
                      </select>
                    </div>
                  </form>

                  {revs.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-ink/60">
                      {revs.slice(0, 3).map((r) => (
                        <li key={r.id} className="flex items-center gap-2 flex-wrap">
                          <span className="pill bg-black/[0.04] text-ink/60">{r.period}</span>
                          <span className="text-amber-600">{stars(r.overall)}</span>
                          {r.reviewer && <span>評価者: {r.reviewer}</span>}
                          {r.comment && <span className="text-ink/45">{r.comment}</span>}
                          {r.goals && <span className="text-ink/45">次期: {r.goals}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-teal-deep">＋ 評価を記録</summary>
                    <form action={addTalentReviewAction} className="mt-2 flex items-end gap-2 flex-wrap">
                      <input type="hidden" name="talent_id" value={t.id} />
                      <div><label className="label">期間 *</label><input name="period" required className="input w-28 text-xs" placeholder="2026H2" /></div>
                      <div>
                        <label className="label">総合1-5</label>
                        <select name="overall" className="input w-auto text-xs" defaultValue="3">
                          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div><label className="label">評価者</label><input name="reviewer" className="input w-28 text-xs" /></div>
                      <div className="min-w-[160px] flex-1"><label className="label">コメント</label><input name="comment" className="input text-xs" /></div>
                      <div className="min-w-[160px] flex-1"><label className="label">次期目標</label><input name="goals" className="input text-xs" /></div>
                      <SubmitButton className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[0.03]" pendingLabel="記録中…">記録</SubmitButton>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
