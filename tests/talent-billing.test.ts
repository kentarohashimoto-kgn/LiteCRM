import { describe, it, expect } from "vitest";
import {
  AFFILIATION_LABEL,
  DEFAULT_TAX_RATE,
  UNSET_PARTY_KEY,
  affiliationLabelOf,
  billingPartyOf,
  billingTotals,
  buildBillingGroups,
  isCurrentTalent,
  matchesAffiliation,
  matchesQuery,
  sortRoster,
  type BillingCompany,
  type RosterTalent,
  type TalentBillingRow,
} from "@/lib/talent-billing";

const company = (id: string, name: string, taxRate = 10): BillingCompany => ({
  id, name, billing_name: null, invoice_no: null, tax_rate: taxRate,
  payment_terms: null, contact_email: null, notes: null, is_active: true,
});

const ACME = company("c1", "株式会社アクメ");
const BETA = company("c2", "ベータ合同会社", 0); // 免税事業者
const COMPANIES = new Map([ACME, BETA].map((c) => [c.id, c]));

const talent = (over: Partial<RosterTalent> & { id: string; name: string }): RosterTalent => ({
  affiliation_type: "unset", company_id: null, tax_rate: null,
  employment_type: "contractor", contract_status: "継続", department: null, role_text: null,
  title: null, layer: null, hourly_rate: null, cost_managed: true, work_report_required: false,
  joined_on: null, left_on: null, email: null, user_id: null,
  ...over,
});

const row = (name: string, party: TalentBillingRow["party"], amount: number, hours = 10): TalentBillingRow => ({
  talentId: name, talentName: name, employmentType: "contractor", party,
  plannedHours: 0, approvedHours: hours, pendingHours: 0, amount, details: [],
});

describe("請求元(所属)の解決", () => {
  it("会社所属はマスタの会社が請求元になり、税率も会社の設定を使う", () => {
    const p = billingPartyOf(talent({ id: "t1", name: "山田", affiliation_type: "company", company_id: "c1" }), COMPANIES);
    expect(p).toMatchObject({ key: "c:c1", name: "株式会社アクメ", type: "company", companyId: "c1", taxRate: 10 });
  });

  it("請求書上の名義が設定されていればそちらを請求元名に使う", () => {
    const named = new Map([["c1", { ...ACME, billing_name: "アクメ株式会社（請求部門）" }]]);
    expect(billingPartyOf(talent({ id: "t1", name: "山田", affiliation_type: "company", company_id: "c1" }), named).name)
      .toBe("アクメ株式会社（請求部門）");
  });

  it("個人事業主は本人が請求元。税率未設定は既定10%、0なら免税事業者として0%", () => {
    const p = billingPartyOf(talent({ id: "t2", name: "鈴木", affiliation_type: "individual" }), COMPANIES);
    expect(p).toMatchObject({ key: "i:t2", name: "鈴木", type: "individual", taxRate: DEFAULT_TAX_RATE });
    const free = billingPartyOf(talent({ id: "t3", name: "佐藤", affiliation_type: "individual", tax_rate: 0 }), COMPANIES);
    expect(free.taxRate).toBe(0);
  });

  it("所属未設定は請求元を確定できないので専用グループにまとめ、税額は計算しない", () => {
    const p = billingPartyOf(talent({ id: "t4", name: "田中" }), COMPANIES);
    expect(p).toMatchObject({ key: UNSET_PARTY_KEY, type: "unset", taxRate: 0 });
  });

  it("会社所属なのにマスタから会社が消えている場合も未設定として扱う(集計から取りこぼさない)", () => {
    const p = billingPartyOf(talent({ id: "t5", name: "高橋", affiliation_type: "company", company_id: "missing" }), COMPANIES);
    expect(p.type).toBe("unset");
  });

  it("所属の表示名は会社名 / 個人（個人事業主） / 所属未設定", () => {
    expect(affiliationLabelOf(talent({ id: "a", name: "A", affiliation_type: "company", company_id: "c2" }), COMPANIES)).toBe("ベータ合同会社");
    expect(affiliationLabelOf(talent({ id: "b", name: "B", affiliation_type: "individual" }), COMPANIES)).toBe(AFFILIATION_LABEL.individual);
    expect(affiliationLabelOf(talent({ id: "c", name: "C" }), COMPANIES)).toBe(AFFILIATION_LABEL.unset);
  });
});

describe("会社ごとの月次請求サマリー", () => {
  const acme = billingPartyOf(talent({ id: "t1", name: "山田", affiliation_type: "company", company_id: "c1" }), COMPANIES);
  const beta = billingPartyOf(talent({ id: "t9", name: "伊藤", affiliation_type: "company", company_id: "c2" }), COMPANIES);
  const solo = billingPartyOf(talent({ id: "t2", name: "鈴木", affiliation_type: "individual" }), COMPANIES);
  const none = billingPartyOf(talent({ id: "t4", name: "田中" }), COMPANIES);

  it("同じ会社の担当者は1つの請求元にまとまり、消費税込みの請求額になる", () => {
    const groups = buildBillingGroups([row("山田", acme, 100_000, 20), row("中村", acme, 50_000, 10)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ subtotal: 150_000, tax: 15_000, total: 165_000, approvedHours: 30 });
    expect(groups[0].members.map((m) => m.talentName)).toEqual(["山田", "中村"]); // 金額の大きい順
  });

  it("免税事業者(税率0%)は消費税が乗らない", () => {
    const [g] = buildBillingGroups([row("伊藤", beta, 80_000)]);
    expect(g).toMatchObject({ subtotal: 80_000, tax: 0, total: 80_000 });
  });

  it("個人事業主は本人単位の請求元として別グループになる", () => {
    const groups = buildBillingGroups([row("山田", acme, 100_000), row("鈴木", solo, 60_000)]);
    expect(groups.map((g) => g.party.name)).toEqual(["株式会社アクメ", "鈴木"]);
    expect(groups[1]).toMatchObject({ subtotal: 60_000, tax: 6_000, total: 66_000 });
  });

  it("所属未設定は金額が大きくても常に末尾に置く(請求先が確定していないため)", () => {
    const groups = buildBillingGroups([row("田中", none, 900_000), row("山田", acme, 100_000)]);
    expect(groups.map((g) => g.party.type)).toEqual(["company", "unset"]);
    expect(groups[1].tax).toBe(0);
  });

  it("端数は小計を丸めてから消費税を計算する", () => {
    const [g] = buildBillingGroups([row("山田", acme, 33_333.4), row("中村", acme, 33_333.4)]);
    expect(g.subtotal).toBe(66_667);
    expect(g.tax).toBe(6_667);
    expect(g.total).toBe(73_334);
  });

  it("全体合計は税抜・消費税・税込と会社数を返す", () => {
    const groups = buildBillingGroups([row("山田", acme, 100_000, 20), row("鈴木", solo, 60_000, 12), row("田中", none, 10_000, 2)]);
    expect(billingTotals(groups)).toEqual({
      subtotal: 170_000, tax: 16_000, total: 186_000, approvedHours: 34, pendingHours: 0, companies: 1,
    });
  });
});

describe("担当者一覧の絞り込み・並べ替え", () => {
  const list: RosterTalent[] = [
    talent({ id: "1", name: "鈴木", affiliation_type: "individual", contract_status: "継続", hourly_rate: 6000 }),
    talent({ id: "2", name: "山田", affiliation_type: "company", company_id: "c1", contract_status: "保留", hourly_rate: 8000, department: "開発" }),
    talent({ id: "3", name: "田中", contract_status: "解約", left_on: "2026-06-30" }),
    talent({ id: "4", name: "伊藤", affiliation_type: "company", company_id: "c2", contract_status: "継続", hourly_rate: 5000, department: "営業" }),
  ];

  it("現在の担当者は契約継続中かつ終了日なし", () => {
    expect(list.filter(isCurrentTalent).map((t) => t.name)).toEqual(["鈴木", "山田", "伊藤"]);
  });

  it("所属で絞り込める(すべて/会社所属/特定の会社/個人/未設定)", () => {
    const names = (f: string) => list.filter((t) => matchesAffiliation(t, f)).map((t) => t.name);
    expect(names("all")).toHaveLength(4);
    expect(names("company")).toEqual(["山田", "伊藤"]);
    expect(names("c1")).toEqual(["山田"]);
    expect(names("individual")).toEqual(["鈴木"]);
    expect(names("unset")).toEqual(["田中"]);
  });

  it("所属順は 会社所属→個人→未設定 の順で、会社内は会社名・氏名順", () => {
    expect(sortRoster(list, "affiliation", COMPANIES).map((t) => t.name)).toEqual(["伊藤", "山田", "鈴木", "田中"]);
  });

  it("氏名順・時給順・契約ステータス順でも並べ替えられる", () => {
    expect(sortRoster(list, "rate", COMPANIES).map((t) => t.name)).toEqual(["山田", "鈴木", "伊藤", "田中"]);
    // 継続(伊藤・鈴木)→保留(山田)→解約(田中)。同ステータス内は氏名の五十音
    expect(sortRoster(list, "status", COMPANIES).map((t) => t.name)).toEqual(["伊藤", "鈴木", "山田", "田中"]);
    // 部署なしが先、部署ありは部署名の五十音(営業→開発)
    expect(sortRoster(list, "department", COMPANIES).slice(-2).map((t) => t.name)).toEqual(["伊藤", "山田"]);
  });

  it("並べ替えは元の配列を壊さない", () => {
    const before = list.map((t) => t.name);
    sortRoster(list, "name", COMPANIES);
    expect(list.map((t) => t.name)).toEqual(before);
  });

  it("検索は氏名だけでなく所属会社名・部署でも当たる", () => {
    expect(matchesQuery(list[1], "アクメ", COMPANIES)).toBe(true);
    expect(matchesQuery(list[1], "開発", COMPANIES)).toBe(true);
    expect(matchesQuery(list[1], "ベータ", COMPANIES)).toBe(false);
    expect(matchesQuery(list[1], "  ", COMPANIES)).toBe(true);
  });
});
