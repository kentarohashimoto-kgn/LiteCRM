import { describe, it, expect, afterEach } from "vitest";
import {
  LAB_MODELS,
  availableModelsFor,
  estimateCostUsd,
  isModelAvailable,
  modelLabel,
  modelPrices,
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
  it("環境変数なしでもカタログの標準価格で算出できる", () => {
    delete process.env.AILAB_PRICES;
    // Sonnet 標準: 入力 $3 / 出力 $15 per 1M
    const { usd, complete } = estimateCostUsd([
      { model_key: "claude-sonnet", input_tokens: 1_000_000, output_tokens: 1_000_000 },
    ]);
    expect(usd).toBeCloseTo(18, 6);
    expect(complete).toBe(true);
  });

  it("Claude 4モデルすべてに標準価格がある（上位ほど高い）", () => {
    delete process.env.AILAB_PRICES;
    const prices = modelPrices();
    for (const key of ["claude-fable", "claude-opus", "claude-sonnet", "claude-haiku"]) {
      expect(prices[key]).toBeDefined();
    }
    expect(prices["claude-fable"].out).toBeGreaterThan(prices["claude-opus"].out);
    expect(prices["claude-opus"].out).toBeGreaterThan(prices["claude-sonnet"].out);
    expect(prices["claude-sonnet"].out).toBeGreaterThan(prices["claude-haiku"].out);
  });

  it("AILAB_PRICES は標準価格を上書きし、指定しなかったモデルは標準のまま", () => {
    process.env.AILAB_PRICES = JSON.stringify({ "claude-sonnet": { in: 2, out: 10 } });
    const prices = modelPrices();
    expect(prices["claude-sonnet"]).toEqual({ in: 2, out: 10 });
    expect(prices["claude-haiku"]).toEqual({ in: 1, out: 5 });
  });

  it("単価を持たないモデルの利用は complete=false で申告する", () => {
    delete process.env.AILAB_PRICES;
    const { usd, complete, unpricedModels } = estimateCostUsd([
      { model_key: "claude-haiku", input_tokens: 1_000_000, output_tokens: 0 },
      { model_key: "image-gen", input_tokens: 0, output_tokens: 100 },
    ]);
    expect(usd).toBeCloseTo(1, 6);
    expect(complete).toBe(false);
    expect(unpricedModels).toEqual(["image-gen"]);
  });

  it("利用実績ゼロのモデルは「単価不明」に数えない", () => {
    delete process.env.AILAB_PRICES;
    const { complete } = estimateCostUsd([{ model_key: "image-gen", input_tokens: 0, output_tokens: 0 }]);
    expect(complete).toBe(true);
  });

  it("AILAB_PRICES が壊れたJSONでも例外にせず標準価格で続行する", () => {
    process.env.AILAB_PRICES = "{not json";
    expect(estimateCostUsd([{ model_key: "claude-haiku", input_tokens: 1_000_000, output_tokens: 0 }]).usd).toBeCloseTo(
      1,
      6,
    );
  });
});
