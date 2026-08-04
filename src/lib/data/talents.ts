/**
 * タレント台帳(担当者)と所属会社マスタの取得、および月次の請求サマリー・稼働実績集計。
 *
 * 集計の元データは稼働報告(work_entries)の「承認済み」実績で、
 * 金額は 承認済み工数 × 原価単価(時給 or 人月単価の時間割り)。
 * 会社ごとの月末請求額は、その会社に所属する担当者の金額合計になる。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { getMonthlyWorkSummary, type MonthlyWorkRow } from "@/lib/data/work-log";
import { hoursToCost } from "@/lib/work-time";
import {
  billingPartyOf,
  buildBillingGroups,
  type BillingCompany,
  type BillingGroup,
  type RosterTalent,
  type TalentBillingRow,
  type WorkDetail,
} from "@/lib/talent-billing";

const TALENT_COLUMNS =
  "id, name, employment_type, contract_status, department, role_text, title, layer, hourly_rate, cost_managed, work_report_required, joined_on, left_on, email, user_id, company_id, affiliation_type, tax_rate";

const COMPANY_COLUMNS = "id, name, billing_name, invoice_no, tax_rate, payment_terms, contact_email, notes, is_active";

/** 所属会社マスタ(表示順は会社名)。 */
export async function getTalentCompanies(): Promise<BillingCompany[]> {
  const sb = getSupabaseServer();
  const r = await sb.from("talent_companies").select(COMPANY_COLUMNS).order("name").limit(500);
  if (r.error) throw new Error(`所属会社マスタの取得に失敗: ${r.error.message}`);
  return (r.data ?? []) as BillingCompany[];
}

/** 台帳の担当者一覧 + 所属会社マスタ(所属の解決に必要なので常にセットで返す)。 */
export async function getTalentRoster(): Promise<{ talents: RosterTalent[]; companies: BillingCompany[]; companyById: Map<string, BillingCompany> }> {
  const sb = getSupabaseServer();
  const [talR, companies] = await Promise.all([
    sb.from("talents").select(TALENT_COLUMNS).order("name").limit(500),
    getTalentCompanies(),
  ]);
  if (talR.error) throw new Error(`タレント台帳の取得に失敗: ${talR.error.message}`);
  return {
    talents: (talR.data ?? []) as RosterTalent[],
    companies,
    companyById: new Map(companies.map((c) => [c.id, c])),
  };
}

/** 所属会社ごとの所属人数(マスタ管理画面の削除可否判定・件数表示に使う)。 */
export function countByCompany(talents: RosterTalent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of talents) {
    if (t.affiliation_type === "company" && t.company_id) m.set(t.company_id, (m.get(t.company_id) ?? 0) + 1);
  }
  return m;
}

export interface MonthlyTalentBilling {
  /** 担当者ごとの月次稼働・金額(所属会社の解決済み)。 */
  rows: TalentBillingRow[];
  /** 請求元(会社 / 個人事業主)ごとのグルーピング。 */
  groups: BillingGroup[];
  companies: BillingCompany[];
  companyById: Map<string, BillingCompany>;
  talents: RosterTalent[];
}

/**
 * 指定月の稼働実績を担当者ごとに集計し、所属(会社 / 個人事業主)でグルーピングする。
 * 稼働単位(案件アサイン・全般稼働)は明細として担当者行にぶら下げる。
 */
export async function getMonthlyTalentBilling(monthStart: string, monthEnd: string): Promise<MonthlyTalentBilling> {
  const [summary, roster] = await Promise.all([getMonthlyWorkSummary(monthStart, monthEnd), getTalentRoster()]);
  const { talents, companies, companyById } = roster;
  const talentById = new Map(talents.map((t) => [t.id, t]));

  // 担当者(台帳に無い稼働者は稼働単位ごと)にまとめる
  const byTalent = new Map<string, TalentBillingRow>();
  for (const r of summary as MonthlyWorkRow[]) {
    const amount = hoursToCost(r.approvedHours, r.costRate, r.rateUnit, r.hoursPerMonth);
    const detail: WorkDetail = {
      key: r.key,
      label: r.label,
      kind: r.kind,
      accountName: r.kind === "general" ? "" : r.accountName,
      oppName: r.oppName,
      plannedHours: r.plannedHours,
      approvedHours: r.approvedHours,
      pendingHours: r.pendingHours,
      amount,
    };
    const t = r.talentId ? talentById.get(r.talentId) ?? null : null;
    // 台帳に紐づかない稼働者は突合できないので稼働単位のまま「所属未設定」に積む
    const groupKey = t ? `t:${t.id}` : `x:${r.key}`;
    const row =
      byTalent.get(groupKey) ??
      byTalent
        .set(groupKey, {
          talentId: t?.id ?? null,
          talentName: t?.name ?? r.label,
          employmentType: t?.employment_type ?? r.kind,
          party: t
            ? billingPartyOf(t, companyById)
            : billingPartyOf({ id: groupKey, name: r.label, affiliation_type: "unset", company_id: null, tax_rate: null }, companyById),
          plannedHours: 0,
          approvedHours: 0,
          pendingHours: 0,
          amount: 0,
          details: [],
        })
        .get(groupKey)!;
    row.details.push(detail);
    row.plannedHours += r.plannedHours;
    row.approvedHours += r.approvedHours;
    row.pendingHours += r.pendingHours;
    row.amount += amount;
  }

  const rows = [...byTalent.values()];
  for (const r of rows) r.details.sort((a, b) => b.approvedHours - a.approvedHours || a.label.localeCompare(b.label, "ja"));
  rows.sort((a, b) => b.amount - a.amount || a.talentName.localeCompare(b.talentName, "ja"));

  return { rows, groups: buildBillingGroups(rows), companies, companyById, talents };
}
