import { describe, it, expect, afterEach } from "vitest";
import { LAB_MODELS, availableModelsFor, isModelAvailable } from "@/lib/ai-lab/models";

/**
 * 「APIキー未設定のモデルはチェックボックスが disabled → 送信に含まれない」ため、
 * 保存のたびに許可設定が消える事故が起きうる。その回避条件をここで固定する。
 * （マージ処理そのものは "use server" ファイル内の private 関数なので、
 *   ここでは同じ規則を再現して不変条件を検証する）
 */
function mergeUnavailableModels(submitted: string[], current: string[]): string[] {
  const kept = current.filter((key) => !isModelAvailable(key));
  return Array.from(new Set([...submitted, ...kept]));
}

const ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;
const ORIG = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k] as string;
  }
});

describe("キー未設定モデルの許可設定を保存で失わない", () => {
  it("画面で操作できなかったモデルは残る", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY; // 画像生成・ChatGPT は操作不能

    // 管理者は Claude だけをチェックして保存した
    const merged = mergeUnavailableModels(["claude-sonnet"], ["claude-sonnet", "image-gen"]);
    expect(merged).toContain("image-gen");
  });

  it("操作できたモデルの解除はきちんと反映される", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;

    // Haiku はチェックできる状態で外した → 消えるのが正しい
    const merged = mergeUnavailableModels(["claude-sonnet"], ["claude-sonnet", "claude-haiku"]);
    expect(merged).not.toContain("claude-haiku");
  });

  it("キーが揃えば通常どおり解除できる", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-openai-test";

    const merged = mergeUnavailableModels(["claude-sonnet"], ["claude-sonnet", "image-gen"]);
    expect(merged).not.toContain("image-gen");
  });

  it("重複しない", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    const merged = mergeUnavailableModels(["image-gen"], ["image-gen"]);
    expect(merged).toEqual(["image-gen"]);
  });
});

describe("画像生成モデルの前提", () => {
  it("OPENAI_API_KEY が無い間は受講者に見えない", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    expect(availableModelsFor(["claude-sonnet", "image-gen"]).map((m) => m.key)).toEqual(["claude-sonnet"]);
  });

  it("キーを入れると許可済みの画像生成が出てくる", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    expect(availableModelsFor(["claude-sonnet", "image-gen"]).map((m) => m.key)).toEqual([
      "claude-sonnet",
      "image-gen",
    ]);
  });

  it("画像生成は image 種別で、既定モデルIDは gpt-image-2", () => {
    delete process.env.AILAB_IMAGE_MODEL;
    const image = LAB_MODELS.find((m) => m.key === "image-gen")!;
    expect(image.kind).toBe("image");
    expect(image.modelId()).toBe("gpt-image-2");
  });
});
