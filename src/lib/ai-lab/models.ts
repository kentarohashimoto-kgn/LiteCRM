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

/** 100万トークンあたりの単価(USD)。管理画面の概算コスト表示に使う。 */
export interface ModelPrice {
  in: number;
  out: number;
}

export interface LabModel {
  key: ModelKey;
  label: string;
  provider: LabProvider;
  kind: "text" | "image";
  /** 実モデルID。環境変数があれば優先する。 */
  modelId: () => string;
  /** 受講者向けの一言説明(モデル選択UIに出す)。 */
  hint: string;
  /**
   * 標準価格(USD / 100万トークン)。請求根拠ではなく管理画面の目安。
   * 未設定のモデル(トークン課金でない画像生成など)は概算から除外し、その旨を画面に出す。
   */
  price?: ModelPrice;
}

export const LAB_MODELS: LabModel[] = [
  {
    key: "claude-fable",
    label: "Claude Fable",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_FABLE || "claude-fable-5",
    hint: "最上位。複雑な整理・長文の設計に強い",
    price: { in: 10, out: 50 },
  },
  {
    key: "claude-opus",
    label: "Claude Opus",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_OPUS || "claude-opus-5",
    hint: "高性能。難しい課題や長い資料の読み解きに",
    price: { in: 5, out: 25 },
  },
  {
    key: "claude-sonnet",
    label: "Claude Sonnet",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_SONNET || "claude-sonnet-5",
    hint: "速度と品質のバランス型。普段使いに",
    price: { in: 3, out: 15 },
  },
  {
    key: "claude-haiku",
    label: "Claude Haiku",
    provider: "anthropic",
    kind: "text",
    modelId: () => process.env.AILAB_MODEL_HAIKU || "claude-haiku-4-5",
    hint: "最速。短い質問や下書きに",
    price: { in: 1, out: 5 },
  },
  {
    key: "openai-chat",
    label: "ChatGPT（最新）",
    provider: "openai",
    kind: "text",
    modelId: () => process.env.OPENAI_CHAT_MODEL || "gpt-5.6",
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
 * カタログの標準価格を土台に、環境変数 AILAB_PRICES で会社別の実勢価格へ上書きできる。
 * 形式: {"claude-sonnet":{"in":3,"out":15}}
 *
 * ※ 標準価格は定価ベース。期間限定の割引や、プロバイダ側の改定は反映されない。
 *   実額と突き合わせる必要がある場合は AILAB_PRICES を設定すること。
 */
export function modelPrices(): Record<string, ModelPrice> {
  const base: Record<string, ModelPrice> = {};
  for (const m of LAB_MODELS) {
    if (m.price) base[m.key] = m.price;
  }

  const raw = process.env.AILAB_PRICES;
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Record<string, { in?: number; out?: number }>;
    for (const [k, v] of Object.entries(parsed)) {
      base[k] = { in: Number(v?.in ?? 0), out: Number(v?.out ?? 0) };
    }
    return base;
  } catch {
    // 壊れた設定で画面を落とさない。標準価格のまま続行する。
    return base;
  }
}

export interface CostEstimate {
  usd: number;
  /**
   * 単価が分からない利用が含まれていないか。
   * false のときは実際のコストが概算より大きいので、画面に注記を出す。
   */
  complete: boolean;
  /** 単価未設定だったモデルキー(画面の注記に使う)。 */
  unpricedModels: string[];
}

/**
 * トークン数から概算コスト(USD)を出す。
 * 単価が無いモデル(トークン課金でない画像生成など)は 0 として足し、complete=false で申告する。
 */
export function estimateCostUsd(
  rows: { model_key: string; input_tokens: number; output_tokens: number }[],
): CostEstimate {
  const prices = modelPrices();
  let usd = 0;
  const unpriced = new Set<string>();
  for (const r of rows) {
    const p = prices[r.model_key];
    if (!p) {
      // 利用実績が無いモデルを「単価不明」と騒がないよう、実際に使われた分だけ数える。
      if (Number(r.input_tokens) > 0 || Number(r.output_tokens) > 0) unpriced.add(r.model_key);
      continue;
    }
    usd += (Number(r.input_tokens) / 1_000_000) * p.in + (Number(r.output_tokens) / 1_000_000) * p.out;
  }
  return { usd, complete: unpriced.size === 0, unpricedModels: Array.from(unpriced) };
}
