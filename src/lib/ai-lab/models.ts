/**
 * AI Lab で受講者に提示するモデルのカタログ。
 *
 * 受講者に見せる表示名(label)と実モデルID(modelId)を分離しているのは、
 * プロバイダのモデル改廃に「環境変数の差し替えだけ」で追従するため。
 * 表示名は研修資料に載るので、実IDが変わっても変えない。
 */

export type ModelKey =
  | "claude-fable"
  | "claude-opus"
  | "claude-sonnet"
  | "claude-haiku"
  | "openai-chat"
  | "image-gen";

export type LabProvider = "anthropic" | "openai";

export interface LabModel {
  key: ModelKey;
  label: string;
  provider: LabProvider;
  kind: "text" | "image";
  /** 実モデルID。環境変数があれば優先する。 */
  modelId: () => string;
  /** 受講者向けの一言説明(モデル選択UIに出す)。 */
  hint: string;
}

export const LAB_MODELS: LabModel[] = [
  {
    key: "claude-fable",
    label: "Claude Fable",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_FABLE || "claude-fable-5",
    hint: "最上位。複雑な整理・長文の設計に強い",
  },
  {
    key: "claude-opus",
    label: "Claude Opus",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_OPUS || "claude-opus-5",
    hint: "高性能。難しい課題や長い資料の読み解きに",
  },
  {
    key: "claude-sonnet",
    label: "Claude Sonnet",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_SONNET || "claude-sonnet-5",
    hint: "速度と品質のバランス型。普段使いに",
  },
  {
    key: "claude-haiku",
    label: "Claude Haiku",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_HAIKU || "claude-haiku-4-5",
    hint: "最速。短い質問や下書きに",
  },
  {
    key: "openai-chat",
    label: "ChatGPT（最新）",
    provider: "openai",
    kind: "text",
    modelId: () => process.env.OPENAI_CHAT_MODEL || "gpt-5.1",
    hint: "OpenAI の最新チャットモデル",
  },
  {
    key: "image-gen",
    label: "画像生成",
    provider: "openai",
    kind: "image",
    modelId: () => process.env.AILAB_IMAGE_MODEL || "gpt-image-2",
    hint: "文章から画像をつくる（gpt-image-2）",
  },
];

export function resolveModel(key: string | null | undefined): LabModel | null {
  if (!key) return null;
  return LAB_MODELS.find((m) => m.key === key) ?? null;
}

export function modelLabel(key: string | null | undefined): string {
  return resolveModel(key)?.label ?? "—";
}

/** APIキーとモデルIDが揃っているモデルだけが実際に使える。 */
export function isModelAvailable(key: string): boolean {
  const m = resolveModel(key);
  if (!m) return false;
  if (!m.modelId()) return false;
  if (m.provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * 受講者に見せるモデル一覧 = 会社の許可リスト ∩ 実際に使えるモデル。
 * 許可リストの順序ではなくカタログ順で返す(画面での並びを安定させるため)。
 */
export function availableModelsFor(allowed: string[] | null | undefined): LabModel[] {
  const set = new Set(allowed ?? []);
  return LAB_MODELS.filter((m) => set.has(m.key) && isModelAvailable(m.key));
}

/**
 * 実際に使う既定モデルを決める。
 * 会社の既定モデルが使えない状態(キー未設定・許可から外れた等)なら、使える先頭にフォールバックする。
 */
export function resolveDefaultModel(
  allowed: string[] | null | undefined,
  preferred: string | null | undefined,
): ModelKey | null {
  const usable = availableModelsFor(allowed);
  if (usable.length === 0) return null;
  const pref = usable.find((m) => m.key === preferred);
  return (pref ?? usable[0]).key;
}

/**
 * 概算コスト単価(USD / 100万トークン)。
 * 環境変数 AILAB_PRICES に {"claude-sonnet":{"in":3,"out":15}} 形式で設定する。
 * 未設定なら管理画面のコスト列は「—」になる(請求根拠には使わない参考値)。
 */
export function modelPrices(): Record<string, { in: number; out: number }> {
  const raw = process.env.AILAB_PRICES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { in?: number; out?: number }>;
    const out: Record<string, { in: number; out: number }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = { in: Number(v?.in ?? 0), out: Number(v?.out ?? 0) };
    }
    return out;
  } catch {
    return {};
  }
}

/** トークン数から概算コスト(USD)を出す。単価未設定のモデルは 0 として扱う。 */
export function estimateCostUsd(
  rows: { model_key: string; input_tokens: number; output_tokens: number }[],
): { usd: number; priced: boolean } {
  const prices = modelPrices();
  if (Object.keys(prices).length === 0) return { usd: 0, priced: false };
  let usd = 0;
  for (const r of rows) {
    const p = prices[r.model_key];
    if (!p) continue;
    usd += (r.input_tokens / 1_000_000) * p.in + (r.output_tokens / 1_000_000) * p.out;
  }
  return { usd, priced: true };
}
