import { describe, it, expect } from "vitest";
import { detectInsights, intentMix, intentMixInsight, type QueryAgg } from "@/lib/seo/analyze";
import { benchmarkCtr, estimateIntentLayer, isBrandQuery, commercialWeight } from "@/lib/seo/benchmark";

const BRAND = ["カトルセ", "catorce"];
const opts = { brandTerms: BRAND };

const q = (query: string, impressions: number, clicks: number, position: number | null, pagePath = "/p"): QueryAgg => ({
  query,
  pagePath,
  impressions,
  clicks,
  position,
});

describe("benchmarkCtr", () => {
  it("順位が上がるほど期待CTRが高い", () => {
    expect(benchmarkCtr(1)!).toBeGreaterThan(benchmarkCtr(3)!);
    expect(benchmarkCtr(3)!).toBeGreaterThan(benchmarkCtr(10)!);
    expect(benchmarkCtr(10)!).toBeGreaterThan(benchmarkCtr(15)!);
  });
  it("順位不明・不正値では null", () => {
    expect(benchmarkCtr(null)).toBeNull();
    expect(benchmarkCtr(0)).toBeNull();
    expect(benchmarkCtr(NaN)).toBeNull();
  });
});

describe("estimateIntentLayer / commercialWeight", () => {
  it("発注検討の語を含めば第1層", () => {
    expect(estimateIntentLayer("生成AI研修 会社")).toBe(1);
    expect(estimateIntentLayer("AI研修 費用 相場")).toBe(1);
    expect(estimateIntentLayer("ai顧問")).toBe(1);
  });
  it("課題認識の語を含めば第2層", () => {
    expect(estimateIntentLayer("生成AI 社内 定着 しない")).toBe(2);
    expect(estimateIntentLayer("ChatGPT 社内ルール 作り方")).toBe(2);
  });
  it("それ以外は第3層（情報収集）", () => {
    expect(estimateIntentLayer("gpt image 2")).toBe(3);
    expect(estimateIntentLayer("claude code")).toBe(3);
  });
  it("商用意図が高いほど係数が大きい", () => {
    expect(commercialWeight("AI研修 費用")).toBeGreaterThan(commercialWeight("gpt image 2"));
  });
});

describe("isBrandQuery", () => {
  it("自社名を含むクエリを指名検索と判定する（空白の有無を無視）", () => {
    expect(isBrandQuery("株式会社カトルセ", BRAND)).toBe(true);
    expect(isBrandQuery("catorce", BRAND)).toBe(true);
    expect(isBrandQuery("生成AI研修 会社", BRAND)).toBe(false);
  });
});

describe("detectInsights", () => {
  it("上位表示なのにクリック0を最重要として検出する", () => {
    // 本番実データの再現: 「claude code」823表示・0クリック・3.2位
    const found = detectInsights([q("claude code", 823, 0, 3.2)], null, opts);
    const zero = found.find((i) => i.kind === "zero_click");
    expect(zero).toBeTruthy();
    expect(zero!.severity).toBe("high");
    expect(zero!.actionType).toBe("title_meta");
  });

  it("順位のわりにCTRが低いものを検出する", () => {
    // 「gpt image 2」4103表示・36クリック(0.88%)・7.2位。目安3.5%を大きく下回る
    const found = detectInsights([q("gpt image 2", 4103, 36, 7.2)], null, opts);
    const ctr = found.find((i) => i.kind === "ctr_opportunity");
    expect(ctr).toBeTruthy();
    expect(Number(ctr!.metric.extraClicks)).toBeGreaterThan(50);
  });

  it("同一クエリで zero_click と ctr_opportunity を二重に出さない", () => {
    const found = detectInsights([q("claude code", 823, 0, 3.2)], null, opts);
    expect(found.filter((i) => i.query === "claude code")).toHaveLength(1);
  });

  it("11〜20位を「あと一歩」として検出する", () => {
    const found = detectInsights([q("notebooklm 使い方", 102, 1, 12.5)], null, opts);
    expect(found.some((i) => i.kind === "striking_distance")).toBe(true);
  });

  it("指名検索は施策対象にしない", () => {
    const found = detectInsights([q("株式会社カトルセ", 724, 74, 2.1)], null, opts);
    expect(found).toHaveLength(0);
  });

  it("表示回数が少ないクエリは判断材料にしない（GSCのしきい値対策）", () => {
    expect(detectInsights([q("まれなクエリ", 5, 0, 2)], null, opts)).toHaveLength(0);
  });

  it("順位低下を検出する", () => {
    const found = detectInsights(
      [q("生成AI研修 費用", 200, 5, 14)],
      [q("生成AI研修 費用", 200, 20, 8)],
      opts,
    );
    const d = found.find((i) => i.kind === "rank_decline");
    expect(d).toBeTruthy();
    expect(d!.severity).toBe("high"); // 6位以上の低下
  });

  it("順位は横ばいでクリックだけ落ちた場合はCTR要因として検出する", () => {
    const found = detectInsights([q("AI顧問 料金", 300, 5, 6)], [q("AI顧問 料金", 300, 30, 6)], opts);
    expect(found.some((i) => i.kind === "click_drop")).toBe(true);
    expect(found.some((i) => i.kind === "rank_decline")).toBe(false);
  });

  it("同一クエリで複数ページが競合していればカニバリとして検出する", () => {
    const found = detectInsights(
      [q("生成AI 研修", 200, 3, 12, "/a"), q("生成AI 研修", 150, 2, 18, "/b")],
      null,
      opts,
    );
    expect(found.some((i) => i.kind === "cannibalization")).toBe(true);
  });

  it("商用意図が高いものが上位に来る（同じ機会量なら売上に近い方を優先）", () => {
    const found = detectInsights(
      [q("gpt image 2", 1000, 0, 5, "/x"), q("生成AI研修 費用", 1000, 0, 5, "/y")],
      null,
      opts,
    );
    expect(found[0].query).toBe("生成AI研修 費用");
  });

  it("件数上限を守る（人が処理できる量を超えない）", () => {
    const many = Array.from({ length: 100 }, (_, i) => q(`kw${i}`, 500, 0, 5, `/p${i}`));
    expect(detectInsights(many, null, { ...opts, limit: 10 })).toHaveLength(10);
  });
});

describe("intentMix / intentMixInsight", () => {
  it("指名を分離し、意図層ごとの表示回数を集計する", () => {
    const mix = intentMix(
      [q("カトルセ", 1000, 100, 2), q("AI研修 費用", 200, 5, 8), q("gpt image 2", 4000, 30, 7)],
      BRAND,
    );
    expect(mix.brand).toBe(1000);
    expect(mix.layer1).toBe(200);
    expect(mix.layer3).toBe(4000);
  });

  it("第1層が15%未満ならサイトレベルの所見を出す", () => {
    const mix = intentMix([q("AI研修 費用", 200, 5, 8), q("gpt image 2", 4000, 30, 7)], BRAND);
    const insight = intentMixInsight(mix);
    expect(insight).toBeTruthy();
    expect(insight!.severity).toBe("high");
    expect(insight!.scope).toBe("site");
  });

  it("第1層が十分にあれば所見を出さない", () => {
    const mix = intentMix([q("AI研修 費用", 3000, 100, 5), q("gpt image 2", 1000, 10, 7)], BRAND);
    expect(intentMixInsight(mix)).toBeNull();
  });

  it("母数が小さいときは判定しない（誤検知の防止）", () => {
    const mix = intentMix([q("gpt image 2", 100, 1, 7)], BRAND);
    expect(intentMixInsight(mix)).toBeNull();
  });
});
