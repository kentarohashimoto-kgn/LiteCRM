/** AI Lab から呼ぶ生成プロバイダの共通インターフェース。 */

export type LabErrorCode =
  | "config_error"
  | "rate_limited"
  | "provider_error"
  | "aborted"
  /** モデルの安全機構が応答を拒否した(HTTP 200 で stop_reason=refusal が返る)。 */
  | "refused"
  /** 添付を含めたリクエストがプロバイダの上限を超えた。 */
  | "too_large";

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

/** モデルへ渡す添付。テキストは本文へ差し込み済みなので、ここには来ない。 */
export interface ChatAttachment {
  kind: "image" | "document";
  mime: string;
  fileName: string;
  /** base64 エンコード済みの中身。 */
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export interface ChatStreamOptions {
  modelId: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  /** 生成された断片が届くたびに呼ばれる。 */
  onDelta: (text: string) => void;
  /**
   * xlsx / docx / pptx / pdf の生成を許可するか。
   * コード実行を伴い従量課金が発生しうるため、会社設定で切り替えられるようにしている。
   */
  enableFileTools?: boolean;
}

/** モデルが生成したファイル(スプレッドシート等)。 */
export interface GeneratedFile {
  fileName: string;
  mime: string;
  data: Buffer;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** enableFileTools のときのみ入りうる。 */
  files?: GeneratedFile[];
}

export interface ChatProvider {
  stream(opts: ChatStreamOptions): Promise<ChatUsage>;
}

export interface GeneratedImage {
  data: Buffer;
  mime: string;
}

/** 画像生成に渡す参照画像(デザインガイド等)。 */
export interface ImageReference {
  fileName: string;
  mime: string;
  data: Buffer;
}

/**
 * 画像の品質。gpt-image は同一モデルでも low/medium/high で単価が約35倍変わるため、
 * 指定しない(＝プロバイダ既定に任せる)状態にしない。
 */
export type ImageQuality = "low" | "medium" | "high";

export interface ImageProvider {
  generate(opts: {
    modelId: string;
    prompt: string;
    n: number;
    signal: AbortSignal;
    quality: ImageQuality;
    /** 1件以上あれば「参照つきの生成」(images/edits)になる。 */
    references?: ImageReference[];
  }): Promise<GeneratedImage[]>;
}

/** 中断(ユーザーの停止ボタン・切断)かどうか。 */
export function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && (e.name === "AbortError" || e.name === "APIUserAbortError")) ||
    (typeof e === "object" && e !== null && "name" in e && (e as { name?: string }).name === "AbortError")
  );
}
