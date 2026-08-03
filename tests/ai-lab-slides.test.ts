import { describe, it, expect } from "vitest";
import {
  MAX_SLIDES,
  buildPlanInstruction,
  buildSlideImagePrompt,
  clampSlideCount,
  extractJsonObject,
  nextPendingPosition,
  parseSlidePlan,
  pptxFileName,
  requestedSlideCount,
  slideProgress,
} from "@/lib/ai-lab/slides";

const validPlan = {
  title: "NTTデータ関西向け提案書",
  styleGuide: "配色は #008C8C 基調、差し色に #F59A2A。です・ます調。1ページ1メッセージ。",
  slides: [
    { title: "表紙", summary: "提案の概要", imagePrompt: "表紙。見出しは『生成AI活用支援のご提案』", notes: "挨拶" },
    { title: "課題", summary: "現状の課題", imagePrompt: "課題を3点、カード型で", notes: "" },
  ],
};

describe("構成案の受け取り", () => {
  it("素のJSONを読める", () => {
    const plan = parseSlidePlan(JSON.stringify(validPlan));
    expect(plan?.title).toBe("NTTデータ関西向け提案書");
    expect(plan?.slides).toHaveLength(2);
    expect(plan?.styleGuide).toContain("#008C8C");
  });

  it("前後に説明文やコードフェンスが付いていても読める", () => {
    // モデルは「はい、構成案です」と前置きしたり ```json で囲んだりする。
    const raw = "承知しました。以下が構成案です。\n\n```json\n" + JSON.stringify(validPlan) + "\n```\nご確認ください。";
    expect(parseSlidePlan(raw)?.slides).toHaveLength(2);
  });

  it("JSONが無ければ null（壊れた構成案で画像生成に進ませない）", () => {
    // ここで通してしまうと、実費をかけて白紙の画像を作ることになる。
    expect(parseSlidePlan("構成案を作れませんでした")).toBeNull();
    expect(parseSlidePlan("")).toBeNull();
  });

  it("壊れたJSONも null", () => {
    expect(parseSlidePlan('{"title": "x", "slides": [')).toBeNull();
  });

  it("slides が空なら null", () => {
    expect(parseSlidePlan(JSON.stringify({ title: "x", slides: [] }))).toBeNull();
  });

  it("上限を超えた枚数は切り捨てる", () => {
    const many = { ...validPlan, slides: Array.from({ length: 30 }, (_, i) => ({ imagePrompt: `p${i}` })) };
    expect(parseSlidePlan(JSON.stringify(many))?.slides).toHaveLength(MAX_SLIDES);
    expect(parseSlidePlan(JSON.stringify(many), 3)?.slides).toHaveLength(3);
  });

  it("中身の無いスライドは落とす", () => {
    const withEmpty = { title: "x", slides: [{ imagePrompt: "ある" }, {}, { title: "", imagePrompt: "" }] };
    expect(parseSlidePlan(JSON.stringify(withEmpty))?.slides).toHaveLength(1);
  });

  it("imagePrompt が無ければ title で代用する（白紙にしない）", () => {
    const plan = parseSlidePlan(JSON.stringify({ title: "x", slides: [{ title: "課題整理" }] }));
    expect(plan?.slides[0].imagePrompt).toBe("課題整理");
  });

  it("タイトルが無ければ連番で補う", () => {
    const plan = parseSlidePlan(JSON.stringify({ slides: [{ imagePrompt: "a" }] }));
    expect(plan?.slides[0].title).toBe("スライド1");
    expect(plan?.title).toBe("無題のスライド");
  });

  it("文字列以外の値が来ても落ちない", () => {
    const weird = { title: 123, styleGuide: null, slides: [{ title: [], imagePrompt: "a", notes: {} }] };
    const plan = parseSlidePlan(JSON.stringify(weird));
    expect(plan?.slides[0].imagePrompt).toBe("a");
    expect(plan?.slides[0].notes).toBe("");
  });
});

describe("JSONの切り出し", () => {
  it("入れ子の括弧で早く閉じない", () => {
    const raw = 'まえおき {"a": {"b": 1}} あとがき';
    expect(extractJsonObject(raw)).toBe('{"a": {"b": 1}}');
  });

  it("文字列の中の括弧に釣られない", () => {
    const raw = '{"a": "} これは文字列 {"}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("エスケープされた引用符を跨げる", () => {
    const raw = '{"a": "say \\"hi\\" }"}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("閉じていなければ null", () => {
    expect(extractJsonObject('{"a": 1')).toBeNull();
    expect(extractJsonObject("なにもない")).toBeNull();
  });
});

describe("枚数の決定", () => {
  it("指示から枚数を拾う", () => {
    expect(requestedSlideCount("10枚で作って")).toBe(10);
    expect(requestedSlideCount("5ページの提案書")).toBe(5);
    expect(requestedSlideCount("make 6 slides")).toBe(6);
  });

  it("指定が無ければ既定値", () => {
    expect(requestedSlideCount("提案書を作って", 8)).toBe(8);
  });

  it("研修環境の上限を超えさせない", () => {
    // 「50枚で」と言われても上限で止める。時間と実費が読めなくなるため。
    expect(requestedSlideCount("50枚で")).toBe(MAX_SLIDES);
    expect(clampSlideCount(999)).toBe(MAX_SLIDES);
    expect(clampSlideCount(0)).toBe(1);
    expect(clampSlideCount(-5)).toBe(1);
    expect(clampSlideCount(Number.NaN)).toBeGreaterThan(0);
  });

  it("小数は切り捨てる", () => {
    expect(clampSlideCount(3.9)).toBe(3);
  });
});

describe("Claudeへの構成案指示", () => {
  it("枚数とJSON形式を明示する", () => {
    const p = buildPlanInstruction("提案書を作って", 7);
    expect(p).toContain("**7枚**");
    expect(p).toContain("ちょうど 7 枚");
    expect(p).toContain('"styleGuide"');
    expect(p).toContain('"imagePrompt"');
  });

  it("指示が空でも成立する", () => {
    expect(buildPlanInstruction("", 5)).toContain("特になし");
  });

  it("画像に文字が焼き込まれることを伝えている", () => {
    // ここが抜けると、モデルが載せる文言を書かず、意味不明な文字の画像が出る。
    expect(buildPlanInstruction("x", 5)).toContain("実際に載せる日本語のテキスト");
  });
});

describe("1枚ぶんの画像プロンプト", () => {
  it("トンマナを毎回添える（ページ間のブレを抑える）", () => {
    const p = buildSlideImagePrompt({
      styleGuide: "配色は #008C8C 基調",
      title: "課題",
      imagePrompt: "課題を3点",
      position: 2,
      total: 10,
    });
    expect(p).toContain("#008C8C");
    expect(p).toContain("2/10");
    expect(p).toContain("課題を3点");
  });

  it("トンマナが無くても成立する", () => {
    const p = buildSlideImagePrompt({ styleGuide: null, title: "表紙", imagePrompt: "", position: 1, total: 3 });
    expect(p).toContain("表紙");
    expect(p).not.toContain("共通のトンマナ");
  });

  it("16:9と全面使用を必ず指定する", () => {
    const p = buildSlideImagePrompt({ styleGuide: "", title: "a", imagePrompt: "b", position: 1, total: 1 });
    expect(p).toContain("16:9");
    expect(p).toContain("白フチ");
  });
});

describe("進捗の集計", () => {
  const items = (...s: string[]) => s.map((status, i) => ({ position: i + 1, status }));

  it("生成済み・失敗・残りを数える", () => {
    const p = slideProgress(items("done", "failed", "pending"));
    expect(p).toMatchObject({ total: 3, done: 1, failed: 1, pending: 1, complete: false });
  });

  it("全部そろったら complete", () => {
    expect(slideProgress(items("done", "done")).complete).toBe(true);
  });

  it("0枚は complete にしない（空のpptxを作らせない）", () => {
    expect(slideProgress([]).complete).toBe(false);
  });

  it("次に作るのは未完了の最も若い番号", () => {
    expect(nextPendingPosition(items("done", "failed", "pending"))).toBe(2);
    expect(nextPendingPosition(items("done", "done"))).toBeNull();
  });

  it("並びが崩れていても番号順で選ぶ", () => {
    expect(nextPendingPosition([
      { position: 3, status: "pending" },
      { position: 1, status: "pending" },
    ])).toBe(1);
  });
});

describe("PPTXのファイル名", () => {
  it("日本語はそのまま使える", () => {
    expect(pptxFileName("提案書 ver1")).toBe("提案書 ver1.pptx");
  });

  it("パスを壊す記号を落とす", () => {
    expect(pptxFileName("a/b:c*d?")).toBe("a_b_c_d_.pptx");
  });

  it("空なら既定名", () => {
    expect(pptxFileName("")).toBe("スライド.pptx");
  });

  it("長すぎる名前は切る", () => {
    expect(pptxFileName("あ".repeat(200)).length).toBeLessThanOrEqual(65);
  });
});
