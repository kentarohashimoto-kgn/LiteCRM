import { describe, it, expect } from "vitest";
import {
  groupGapsByPlan,
  targetPositionOf,
  extraClicksOf,
  planProposalTitle,
  keywordLine,
  type KeywordRankingRow,
} from "@/lib/seo/plan-gap";

/**
 * 改善提案の単位が「記事1本」になっているかを検証する。
 *
 * 2026-08-08 のレビューで、承認画面に「狙う語『生成AI研修』を取る（新規記事の作成）」が
 * 4件並んでいた。原因の1つが、記事プラン（1記事=メインKW1つ+サブKW数語）を
 * 無視して1語ずつ提案していたこと。ここが崩れると
 *   ・同じ記事の提案が何件も並ぶ
 *   ・承認するたびに別々の記事が作られ、薄い記事が量産される
 * が再発するので、束ね方をテストで固定する。
 */

const row = (o: Partial<KeywordRankingRow>): KeywordRankingRow => ({
  keyword_id: o.query ?? "kw",
  query: "生成AI研修",
  search_volume: 1000,
  target_position_6m: 10,
  target_position_12m: 3,
  clicks: 0,
  impressions: 0,
  current_position: null,
  gap_status: "no_page",
  ...o,
});

const PLAN = {
  article_plan_id: "plan-1",
  plan_title: "法人向け生成AI研修｜実務定着まで",
  plan_main_keyword: "生成AI研修",
};

describe("groupGapsByPlan", () => {
  it("同じ記事プランの語は1件に束ねられる（1語1提案にしない）", () => {
    const out = groupGapsByPlan([
      row({ ...PLAN, query: "生成AI研修", search_volume: 1000 }),
      row({ ...PLAN, query: "生成AI研修 費用", search_volume: 300 }),
      row({ ...PLAN, query: "AI研修 企業", search_volume: 200 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].keywords).toHaveLength(3);
    expect(out[0].mainKeyword).toBe("生成AI研修");
    expect(out[0].planTitle).toBe(PLAN.plan_title);
  });

  it("期待値はサブKW合計。1語ぶんで判断して見送るのを防ぐ", () => {
    const single = groupGapsByPlan([row({ ...PLAN, query: "生成AI研修", search_volume: 1000 })]);
    const bundled = groupGapsByPlan([
      row({ ...PLAN, query: "生成AI研修", search_volume: 1000 }),
      row({ ...PLAN, query: "生成AI研修 費用", search_volume: 300 }),
    ]);
    expect(bundled[0].totalExtraClicks).toBeGreaterThan(single[0].totalExtraClicks);
    expect(bundled[0].totalVolume).toBe(1300);
  });

  it("記事プランに紐付いていない語は、その語だけの候補になる", () => {
    const out = groupGapsByPlan([
      row({ query: "野良キーワードA", article_plan_id: null }),
      row({ query: "野良キーワードB", article_plan_id: null }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].planId).toBeNull();
  });

  it("伸びしろが無い語（目標順位を既に達成）は落とす", () => {
    // 月1000検索・目標10位(CTR 2.5%)に対して既に100クリック取れている
    const out = groupGapsByPlan([row({ ...PLAN, query: "生成AI研修", clicks: 100 })]);
    expect(out).toHaveLength(0);
  });

  it("対策ページが無ければ新規記事、あって圏外ならリライト、10位以内ならタイトル改善", () => {
    const noPage = groupGapsByPlan([row({ ...PLAN, is_existing_page: false })]);
    expect(noPage[0].actionType).toBe("new_article");

    const hasPage = groupGapsByPlan([
      row({ ...PLAN, is_existing_page: true, planned_url: "/ai-training", current_position: 35, gap_status: "far" }),
    ]);
    expect(hasPage[0].actionType).toBe("rewrite");

    const top10 = groupGapsByPlan([
      row({
        ...PLAN,
        is_existing_page: true,
        planned_url: "/ai-training",
        current_position: 6,
        gap_status: "top10",
        target_position_6m: 1,
      }),
    ]);
    expect(top10[0].actionType).toBe("title_meta");
  });

  it("dropped のプランは提案に出さない", () => {
    expect(groupGapsByPlan([row({ ...PLAN, plan_status: "dropped" })])).toHaveLength(0);
  });

  it("期待値の大きいプランから並ぶ", () => {
    const out = groupGapsByPlan([
      row({ article_plan_id: "small", plan_main_keyword: "小", query: "小", search_volume: 100 }),
      row({ article_plan_id: "big", plan_main_keyword: "大", query: "大", search_volume: 5000 }),
    ]);
    expect(out[0].mainKeyword).toBe("大");
  });

  it("第1層の語が1つでもあればプラン全体を第1層として扱う", () => {
    const out = groupGapsByPlan([
      row({ ...PLAN, query: "生成AI研修", intent_layer: 3 }),
      row({ ...PLAN, query: "生成AI研修 費用", intent_layer: 1 }),
    ]);
    expect(out[0].layer1).toBe(true);
  });
});

describe("targetPositionOf", () => {
  it("6ヶ月目標を優先する（12ヶ月目標で期待値を出すと過大になる）", () => {
    expect(targetPositionOf(row({ target_position_6m: 10, target_position_12m: 3 }))).toBe(10);
    expect(targetPositionOf(row({ target_position_6m: null, target_position_12m: 3 }))).toBe(3);
    expect(targetPositionOf(row({ target_position_6m: null, target_position_12m: null }))).toBe(10);
  });
});

describe("extraClicksOf", () => {
  it("既に取れているクリックは伸びしろから引く", () => {
    const fresh = extraClicksOf(row({ search_volume: 1000, clicks: 0 }));
    const partial = extraClicksOf(row({ search_volume: 1000, clicks: 10 }));
    expect(fresh - partial).toBe(10);
  });

  it("マイナスにはならない", () => {
    expect(extraClicksOf(row({ search_volume: 100, clicks: 999 }))).toBe(0);
  });
});

describe("提案タイトル", () => {
  it("複数語を束ねたときは記事名と語数を出す", () => {
    const [c] = groupGapsByPlan([
      row({ ...PLAN, query: "生成AI研修" }),
      row({ ...PLAN, query: "生成AI研修 費用" }),
    ]);
    expect(planProposalTitle(c, "新規記事の作成")).toBe(
      "記事「法人向け生成AI研修｜実務定着まで」で2語を取る（新規記事の作成）",
    );
  });

  it("1語だけなら従来どおり語名で出す", () => {
    const [c] = groupGapsByPlan([row({ query: "AI顧問", article_plan_id: null })]);
    expect(planProposalTitle(c, "新規記事の作成")).toBe("狙う語「AI顧問」を取る（新規記事の作成）");
  });
});

describe("keywordLine", () => {
  it("現在順位・目標順位・伸びしろを1行で読める形にする", () => {
    const [c] = groupGapsByPlan([row({ ...PLAN, query: "生成AI研修", search_volume: 1000 })]);
    const line = keywordLine(c.keywords[0]);
    expect(line).toContain("生成AI研修");
    expect(line).toContain("圏外");
    expect(line).toContain("目標10位");
  });
});
