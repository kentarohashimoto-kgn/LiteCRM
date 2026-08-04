/**
 * 担当者(タレント)の所属会社と、月次の請求サマリー・稼働実績集計の純関数。
 *
 * 所属は3種類:
 *   company    … 会社所属(所属会社マスタの1社に紐づく)
 *   individual … 個人事業主のため個人(請求元は本人)
 *   unset      … 未設定(既存データの移行途中。請求集計から切り出して警告する)
 *
 * 請求元(BillingParty)は「会社」または「個人事業主本人」。
 * 会社ごとの月末請求額は、その会社に所属する担当者の承認済み稼働金額の合計。
 */

export type AffiliationType = "company" | "individual" | "unset";

/** 消費税率が未設定の個人事業主に適用する既定税率(%)。 */
export const DEFAULT_TAX_RATE = 10;

/** 未設定担当者をまとめる擬似請求元のキー。 */
export const UNSET_PARTY_KEY = "unset";

export const AFFILIATION_LABEL: Record<AffiliationType, string> = {
  company: "会社所属",
  individual: "個人（個人事業主）",
  unset: "所属未設定",
};

export interface BillingCompany {
  id: string;
  name: string;
  billing_name: string | null;
  invoice_no: string | null;
  tax_rate: number;
  payment_terms: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
}

/** 台帳の担当者(所属の解決に必要な最小項目)。 */
export interface TalentAffiliation {
  id: string;
  name: string;
  affiliation_type: AffiliationType;
  company_id: string | null;
  tax_rate: number | null;
}

/** 請求元。会社所属なら会社、個人事業主なら本人が請求元になる。 */
export interface BillingParty {
  key: string; // "c:<companyId>" / "i:<talentId>" / "unset"
  name: string;
  type: AffiliationType;
  companyId: string | null;
  taxRate: number; // %
  invoiceNo: string | null;
  paymentTerms: string | null;
}

/** 請求元を解決する。所属未設定は1つの擬似請求元にまとめる(税額は計算しない)。 */
export function billingPartyOf(t: TalentAffiliation, companies: Map<string, BillingCompany>): BillingParty {
  if (t.affiliation_type === "company" && t.company_id) {
    const c = companies.get(t.company_id);
    if (c) {
      return {
        key: `c:${c.id}`,
        name: c.billing_name?.trim() || c.name,
        type: "company",
        companyId: c.id,
        taxRate: Number(c.tax_rate) || 0,
        invoiceNo: c.invoice_no,
        paymentTerms: c.payment_terms,
      };
    }
  }
  if (t.affiliation_type === "individual") {
    return {
      key: `i:${t.id}`,
      name: t.name,
      type: "individual",
      companyId: null,
      taxRate: t.tax_rate == null ? DEFAULT_TAX_RATE : Number(t.tax_rate),
      invoiceNo: null,
      paymentTerms: null,
    };
  }
  return { key: UNSET_PARTY_KEY, name: "所属未設定", type: "unset", companyId: null, taxRate: 0, invoiceNo: null, paymentTerms: null };
}

/** 担当者の1稼働単位(案件アサイン or 全般稼働)の明細。 */
export interface WorkDetail {
  key: string;
  label: string;
  kind: string; // external / internal / general
  accountName: string;
  oppName: string;
  plannedHours: number;
  approvedHours: number;
  pendingHours: number;
  amount: number; // 税抜(承認済み工数 × 単価)
}

/** 担当者ごとの月次稼働・請求行。 */
export interface TalentBillingRow {
  talentId: string | null; // null = 台帳に無い稼働者(社員アサイン等)
  talentName: string;
  employmentType: string;
  party: BillingParty;
  plannedHours: number;
  approvedHours: number;
  pendingHours: number;
  amount: number; // 税抜
  details: WorkDetail[];
}

/** 請求元ごとの月次サマリー。 */
export interface BillingGroup {
  party: BillingParty;
  members: TalentBillingRow[];
  plannedHours: number;
  approvedHours: number;
  pendingHours: number;
  subtotal: number; // 税抜
  tax: number;
  total: number; // 税込
}

/** 担当者行を請求元ごとにまとめる。未設定グループは常に末尾。 */
export function buildBillingGroups(rows: TalentBillingRow[]): BillingGroup[] {
  const byKey = new Map<string, BillingGroup>();
  for (const r of rows) {
    const g =
      byKey.get(r.party.key) ??
      byKey
        .set(r.party.key, {
          party: r.party,
          members: [],
          plannedHours: 0,
          approvedHours: 0,
          pendingHours: 0,
          subtotal: 0,
          tax: 0,
          total: 0,
        })
        .get(r.party.key)!;
    g.members.push(r);
    g.plannedHours += r.plannedHours;
    g.approvedHours += r.approvedHours;
    g.pendingHours += r.pendingHours;
    g.subtotal += r.amount;
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.members.sort((a, b) => b.amount - a.amount || a.talentName.localeCompare(b.talentName, "ja"));
    g.subtotal = Math.round(g.subtotal);
    g.tax = Math.round((g.subtotal * g.party.taxRate) / 100);
    g.total = g.subtotal + g.tax;
  }
  // 金額の大きい請求元を上に。未設定は常に末尾(請求先が確定していないため)。
  groups.sort((a, b) => {
    const au = a.party.type === "unset" ? 1 : 0;
    const bu = b.party.type === "unset" ? 1 : 0;
    if (au !== bu) return au - bu;
    return b.total - a.total || a.party.name.localeCompare(b.party.name, "ja");
  });
  return groups;
}

/** 請求サマリーの全体合計。 */
export function billingTotals(groups: BillingGroup[]): {
  subtotal: number;
  tax: number;
  total: number;
  approvedHours: number;
  pendingHours: number;
  companies: number;
} {
  return groups.reduce(
    (acc, g) => ({
      subtotal: acc.subtotal + g.subtotal,
      tax: acc.tax + g.tax,
      total: acc.total + g.total,
      approvedHours: acc.approvedHours + g.approvedHours,
      pendingHours: acc.pendingHours + g.pendingHours,
      companies: acc.companies + (g.party.type === "company" ? 1 : 0),
    }),
    { subtotal: 0, tax: 0, total: 0, approvedHours: 0, pendingHours: 0, companies: 0 },
  );
}

// ---- 担当者一覧の絞り込み・並べ替え ----

/** 台帳の担当者一覧行(所属フィルター・ソートに使う項目)。 */
export interface RosterTalent extends TalentAffiliation {
  employment_type: string;
  contract_status: string;
  department: string | null;
  role_text: string | null;
  title: string | null;
  layer: string | null;
  hourly_rate: number | null;
  cost_managed: boolean;
  work_report_required: boolean;
  joined_on: string | null;
  left_on: string | null;
  email: string | null;
  user_id: string | null;
}

/** 契約継続中とみなすステータス(台帳の運用値)。 */
export const ACTIVE_CONTRACT_STATUSES = ["継続", "保留", "Ｘジム", "パフォ悪"];
const ACTIVE_SET = new Set(ACTIVE_CONTRACT_STATUSES);

/** 「現在の担当者」= 契約継続中かつ終了日なし。 */
export function isCurrentTalent(t: Pick<RosterTalent, "contract_status" | "left_on">): boolean {
  return ACTIVE_SET.has(t.contract_status) && !t.left_on;
}

/** 所属の表示名。会社所属は会社名、個人事業主は「個人（個人事業主）」。 */
export function affiliationLabelOf(t: TalentAffiliation, companies: Map<string, BillingCompany>): string {
  if (t.affiliation_type === "company" && t.company_id) return companies.get(t.company_id)?.name ?? "（削除済みの会社）";
  return AFFILIATION_LABEL[t.affiliation_type] ?? AFFILIATION_LABEL.unset;
}

/**
 * 所属フィルター。値は "all" / "unset" / "individual" / "company"(会社所属すべて)
 * / 会社ID(特定の1社)。
 */
export function matchesAffiliation(t: TalentAffiliation, filter: string): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "unset") return t.affiliation_type === "unset";
  if (filter === "individual") return t.affiliation_type === "individual";
  if (filter === "company") return t.affiliation_type === "company";
  return t.affiliation_type === "company" && t.company_id === filter;
}

export type RosterSort = "affiliation" | "name" | "status" | "rate" | "department";

const STATUS_RANK: Record<string, number> = { 継続: 0, 保留: 1, Ｘジム: 2, パフォ悪: 3, ほぼ解約: 4, 解約: 5 };
/** 所属の並び順: 会社所属 → 個人 → 未設定。同順位内は会社名/氏名。 */
const AFFILIATION_RANK: Record<AffiliationType, number> = { company: 0, individual: 1, unset: 2 };

/** 担当者一覧の並べ替え(同値は氏名の五十音)。 */
export function sortRoster<T extends RosterTalent>(list: T[], sort: RosterSort, companies: Map<string, BillingCompany>): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "ja");
  const arr = [...list];
  switch (sort) {
    case "name":
      return arr.sort(byName);
    case "rate":
      return arr.sort((a, b) => (Number(b.hourly_rate) || 0) - (Number(a.hourly_rate) || 0) || byName(a, b));
    case "department":
      return arr.sort((a, b) => (a.department ?? "").localeCompare(b.department ?? "", "ja") || byName(a, b));
    case "status":
      return arr.sort(
        (a, b) => (STATUS_RANK[a.contract_status] ?? 9) - (STATUS_RANK[b.contract_status] ?? 9) || byName(a, b),
      );
    case "affiliation":
    default:
      return arr.sort((a, b) => {
        const d = AFFILIATION_RANK[a.affiliation_type] - AFFILIATION_RANK[b.affiliation_type];
        if (d !== 0) return d;
        return affiliationLabelOf(a, companies).localeCompare(affiliationLabelOf(b, companies), "ja") || byName(a, b);
      });
  }
}

/** 氏名・所属会社名・部署・役割の部分一致検索。 */
export function matchesQuery(t: RosterTalent, q: string, companies: Map<string, BillingCompany>): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [t.name, t.department, t.role_text, t.title, t.layer, t.email, affiliationLabelOf(t, companies)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(s);
}
