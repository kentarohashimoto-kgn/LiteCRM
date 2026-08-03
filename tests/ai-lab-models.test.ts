import { describe, it, expect, afterEach } from "vitest";
import {
  LAB_MODELS,
  availableModelsFor,
  estimateCostUsd,
  isModelAvailable,
  modelLabel,
  resolveDefaultModel,
  resolveModel,
} from "@/lib/ai-lab/models";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_CHAT_MODEL",
  "AILAB_IMAGE_MODEL",
  "AILAB_MODEL_SONNET",
  "AILAB_PRICES",
] as const;
const ORIG = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k] as string;
  }
});

describe("モデルカタログ", () => {
  it("要望どおり6モデル(Claude4種 + ChatGPT + 画像生成)を持つ", () => {
    expect(LAB_MODELS.map((m) => m.key)).toEqual([
      "claude-fable",
      "claude-opus",
      "claude-sonnet",
      "claude-haiku",
      "openai-chat",
      "image-gen",
    ]);
  });

  it("Claude各モデルの既定IDが定義どおり", () => {
    delete process.env.AILAB_MODEL_SONNET;
    const byKey = Object.fromEntries(LAB_MODELS.map((m) => [m.key, m.modelId()]));
    expect(byKey["claude-fable"]).toBe("claude-fable-5");
    expect(byKey["claude-opus"]).toBe("claude-opus-5");
    expect(byKey["claude-sonnet"]).toBe("claude-sonnet-5");
    // 日付サフィックス付きの完全IDではなくエイリアスを使う（公式ガイドの指定）
    expect(byKey["claude-haiku"]).toBe("claude-haiku-4-5");
  });

  it("画像生成の既定は gpt-image-2", () => {
    delete process.env.AILAB_IMAGE_MODEL;
    expect(resolveModel("image-gen")?.modelId()).toBe("gpt-image-2");
  });

  it("環境変数を設定すると実モデルIDを差し替えられる", () => {
    process.env.AILAB_MODEL_SONNET = "claude-sonnet-9";
    expect(resolveModel("claude-sonnet")?.modelId()).toBe("claude-sonnet-9");
  });

  it("未知のキーは null。表示名は「—」にフォールバックする", () => {
    expect(resolveModel("nope")).toBeNull();
    expect(resolveModel(null)).toBeNull();
    expect(modelLabel("nope")).toBe("—");
    expect(modelLabel("claude-opus")).toBe("Claude Opus");
  });
});

describe("モデルの利用可否", () => {
  it("APIキーが無いモデルは使えない", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    expect(isModelAvailable("claude-sonnet")).toBe(true);
    expect(isModelAvailable("openai-chat")).toBe(false);
    expect(isModelAvailable("image-gen")).toBe(false);
  });

  it("会社の許可リストとの積集合だけが受講者に見える", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    const usable = availableModelsFor(["claude-haiku", "openai-chat", "unknown-model"]);
    expect(usable.map((m) => m.key)).toEqual(["claude-haiku"]);
  });

  it("許可リストが空・未設定なら空になる", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(availableModelsFor([])).toEqual([]);
    expect(availableModelsFor(null)).toEqual([]);
  });

  it("既定モデルが使えないときは使える先頭にフォールバックする", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    // 既定に openai-chat が残っていても、キー未設定なので Claude 側へ倒れる
    expect(resolveDefaultModel(["claude-opus", "openai-chat"], "openai-chat")).toBe("claude-opus");
    expect(resolveDefaultModel(["claude-opus", "claude-haiku"], "claude-haiku")).toBe("claude-haiku");
    expect(resolveDefaultModel([], "claude-haiku")).toBeNull();
  });
});

describe("概算コスト", () => {
  it("単価未設定なら priced=false（画面は「—」表示）", () => {
    delete process.env.AILAB_PRICES;
    expect(estimateCostUsd([{ model_key: "claude-sonnet", input_tokens: 1000, output_tokens: 1000 }])).toEqual({
      usd: 0,
      priced: false,
    });
  });

  it("単価が設定されていればトークン数から算出する", () => {
    process.env.AILAB_PRICES = JSON.stringify({ "claude-sonnet": { in: 3, out: 15 } });
    const { usd, priced } = estimateCostUsd([
      { model_key: "claude-sonnet", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { model_key: "claude-haiku", input_tokens: 1_000_000, output_tokens: 1_000_000 }, // 単価未定義は0円扱い
    ]);
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(18, 6);
  });

  it("AILAB_PRICES が壊れたJSONでも例外にしない", () => {
    process.env.AILAB_PRICES = "{not json";
    expect(estimateCostUsd([{ model_key: "claude-sonnet", input_tokens: 1, output_tokens: 1 }]).priced).toBe(false);
  });
});
