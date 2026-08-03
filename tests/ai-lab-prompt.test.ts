import { describe, it, expect } from "vitest";
import { BASE_GUARDRAIL, buildHistory, buildSystemPrompt } from "@/lib/ai-lab/prompt";

describe("システムプロンプトの合成", () => {
  it("プリセットの有無にかかわらずベースガードレールで始まる", () => {
    expect(buildSystemPrompt(null, []).system.startsWith(BASE_GUARDRAIL)).toBe(true);
    expect(buildSystemPrompt({ system_prompt: "あなたは講師です" }, []).system.startsWith(BASE_GUARDRAIL)).toBe(true);
  });

  it("プリセットなし・アセットなしならガードレールだけ", () => {
    const built = buildSystemPrompt(null, []);
    expect(built.system).toBe(BASE_GUARDRAIL);
    expect(built.truncated).toBe(false);
    expect(built.assetChars).toBe(0);
  });

  it("プリセットのプロンプトはガードレールの後ろに置かれる(上書きされない)", () => {
    const built = buildSystemPrompt({ system_prompt: "常に英語で答えてください" }, []);
    expect(built.system.indexOf(BASE_GUARDRAIL)).toBeLessThan(built.system.indexOf("常に英語で答えてください"));
  });

  it("アセットは資料名つきの見出しで連結される", () => {
    const built = buildSystemPrompt({ system_prompt: "" }, [
      { file_name: "デザインガイド", extracted_text: "配色はティール" },
      { file_name: "文体ルール", extracted_text: "です・ます調" },
    ]);
    expect(built.system).toContain("## 参考資料: デザインガイド");
    expect(built.system).toContain("配色はティール");
    expect(built.system).toContain("## 参考資料: 文体ルール");
    expect(built.truncated).toBe(false);
  });

  it("本文が空のアセットは無視する", () => {
    const built = buildSystemPrompt(null, [
      { file_name: "空ファイル", extracted_text: "" },
      { file_name: "null", extracted_text: null },
    ]);
    expect(built.system).toBe(BASE_GUARDRAIL);
    expect(built.assetChars).toBe(0);
  });

  it("注入上限を超えると末尾を切り詰めて truncated=true", () => {
    const built = buildSystemPrompt(null, [{ file_name: "長文", extracted_text: "あ".repeat(500) }], 100);
    expect(built.truncated).toBe(true);
    expect(built.assetChars).toBe(100);
  });

  it("上限ちょうどなら切り詰めない", () => {
    const header = "## 参考資料: A\n";
    const body = "い".repeat(50);
    const built = buildSystemPrompt(null, [{ file_name: "A", extracted_text: body }], header.length + body.length);
    expect(built.truncated).toBe(false);
  });

  it("2件目が上限に収まらない場合も例外にせず truncated=true", () => {
    const built = buildSystemPrompt(
      null,
      [
        { file_name: "A", extracted_text: "あ".repeat(60) },
        { file_name: "B", extracted_text: "い".repeat(60) },
      ],
      80,
    );
    expect(built.truncated).toBe(true);
    expect(built.assetChars).toBeLessThanOrEqual(80);
  });
});

describe("会話履歴の切り詰め", () => {
  const msg = (role: "user" | "assistant", content: string) => ({ role, content });

  it("予算内なら全件そのまま(時系列順)", () => {
    const history = buildHistory([msg("user", "a"), msg("assistant", "b"), msg("user", "c")], 1000);
    expect(history.map((m) => m.content)).toEqual(["a", "b", "c"]);
  });

  it("予算を超えたら古いものから落とす", () => {
    const history = buildHistory(
      [msg("user", "x".repeat(50)), msg("assistant", "y".repeat(50)), msg("user", "z".repeat(50))],
      120,
    );
    expect(history.map((m) => m.content[0])).toEqual(["y", "z"]);
  });

  it("最新のメッセージは予算を超えても必ず残す(質問そのものが消えない)", () => {
    const history = buildHistory([msg("user", "old"), msg("user", "q".repeat(500))], 10);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("q".repeat(500));
  });

  it("本文が空の行(エラー記録など)は文脈に含めない", () => {
    const history = buildHistory([msg("user", "質問"), msg("assistant", ""), msg("assistant", "   ")], 1000);
    expect(history.map((m) => m.content)).toEqual(["質問"]);
  });

  it("空配列でも例外にしない", () => {
    expect(buildHistory([], 100)).toEqual([]);
  });
});
