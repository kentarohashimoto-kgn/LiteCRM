/** AI Lab から呼ぶ生成プロバイダの共通インターフェース。 */

export type LabErrorCode =
  | "config_error"
  | "rate_limited"
  | "provider_error"
  | "aborted"
  /** モデルの安全機構が応答を拒否した(HTTP 200 で stop_reason=refusal が返る)。 */
  | "refused";

/** プロバイダ固有の例外を、画面に出す原因区分へ正規化して運ぶ。 */
export class LabProviderError extends Error {
  constructor(
    public readonly code: LabErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LabProviderError";
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatStreamOptions {
  modelId: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  /** 生成された断片が届くたびに呼ばれる。 */
  onDelta: (text: string) => void;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatProvider {
  stream(opts: ChatStreamOptions): Promise<ChatUsage>;
}

export interface GeneratedImage {
  data: Buffer;
  mime: string;
}

export interface ImageProvider {
  generate(opts: { modelId: string; prompt: string; n: number; signal: AbortSignal }): Promise<GeneratedImage[]>;
}

/** 中断(ユーザーの停止ボタン・切断)かどうか。 */
export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError")) ||
    (typeof e === "object" && e !== null && "name" in e && (e as { name?: string }).name === "AbortError")
  );
}
