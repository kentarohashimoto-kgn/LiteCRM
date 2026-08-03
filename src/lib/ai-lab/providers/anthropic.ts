import Anthropic from "@anthropic-ai/sdk";
import {
  LabProviderError,
  isAbortError,
  type ChatMessage,
  type ChatProvider,
  type ChatStreamOptions,
  type ChatUsage,
  type GeneratedFile,
} from "./types";

/**
 * Claude(Anthropic)のストリーミング。
 * エラー区分は既存の src/server/actions/ai.ts と同じ考え方に揃えている。
 *
 * ファイル生成(xlsx/docx/pptx/pdf)を有効にすると、Agent Skills ＋ コード実行ツールを付ける。
 * このときサーバー側でツールが回るので、逐次テキストは stream で受けつつ、
 * 生成物の取り出しは finalMessage() の完成ブロックから行う(部分ブロックを自前で組み立てない)。
 */

// 生成物の作成に使う Anthropic 提供スキル。
const FILE_SKILLS = ["xlsx", "docx", "pptx", "pdf"] as const;
const FILE_TOOL_BETAS = ["code-execution-2025-08-25", "skills-2025-10-02", "files-api-2025-04-14"];
/** サーバー側ツールが上限に達して pause_turn になったときの再開回数。 */
const MAX_CONTINUATIONS = 4;

const EXT_MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function mimeForFile(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** 添付を Messages API のコンテンツブロックへ変換する。 */
function toContentBlocks(m: ChatMessage): string | unknown[] {
  if (!m.attachments || m.attachments.length === 0) return m.content;
  const blocks: unknown[] = [];
  for (const a of m.attachments) {
    if (a.kind === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mime, data: a.data } });
    } else {
      // PDF はページ画像とテキストの両方が読まれる。タイトルを付けて複数添付を区別しやすくする。
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: a.mime, data: a.data },
        title: a.fileName,
      });
    }
  }
  // 添付を先、指示を後に置く(モデルが資料を読んでから指示を解釈する並び)。
  blocks.push({ type: "text", text: m.content });
  return blocks;
}

function toApiError(e: unknown): LabProviderError {
  if (isAbortError(e)) return new LabProviderError("aborted");
  if (e instanceof Anthropic.AuthenticationError) return new LabProviderError("config_error", "APIキーが無効です");
  if (e instanceof Anthropic.RateLimitError) return new LabProviderError("rate_limited");
  if (e instanceof Anthropic.APIError) {
    // 413 は添付でリクエストが膨らみすぎたケース。原因が分かる文言にする。
    if (e.status === 413) return new LabProviderError("too_large", "添付ファイルが大きすぎます");
    return new LabProviderError("provider_error", `Anthropic API エラー(${e.status})`);
  }
  return new LabProviderError("provider_error", "Anthropic への接続に失敗しました");
}

/** コード実行の結果ブロックから、生成されたファイルのIDを拾う。 */
function collectFileIds(content: unknown[]): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.file_id === "string") ids.push(obj.file_id);
    // 結果ブロックは content の下にさらに配列を持つ形が複数あるため、素直に潜る。
    if (obj.content) walk(obj.content);
  };
  walk(content);
  return Array.from(new Set(ids));
}

/** 応答のうちこのプロバイダが読む部分だけ。beta/非betaの型差を吸収する。 */
interface FinalMessage {
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  stop_reason?: string | null;
  content: unknown[];
}

/**
 * 1往復ぶんのストリーミング。
 * ファイル生成の有無で beta/非beta のクライアントが分かれるが、
 * 呼び出し側は同じ形の結果を受け取れるようにここで揃える。
 */
async function runOnce(
  client: Anthropic,
  params: Record<string, unknown>,
  useFileTools: boolean,
  signal: AbortSignal,
  onDelta: (t: string) => void,
): Promise<FinalMessage> {
  if (useFileTools) {
    const stream = client.beta.messages.stream(
      params as unknown as Parameters<typeof client.beta.messages.stream>[0],
      { signal },
    );
    stream.on("text", onDelta);
    return (await stream.finalMessage()) as unknown as FinalMessage;
  }
  const stream = client.messages.stream(
    params as unknown as Parameters<typeof client.messages.stream>[0],
    { signal },
  );
  stream.on("text", onDelta);
  return (await stream.finalMessage()) as unknown as FinalMessage;
}

export const anthropicChat: ChatProvider = {
  async stream(opts: ChatStreamOptions): Promise<ChatUsage> {
    if (!process.env.ANTHROPIC_API_KEY) throw new LabProviderError("config_error", "ANTHROPIC_API_KEY が未設定です");

    const client = new Anthropic();
    const useFileTools = Boolean(opts.enableFileTools);

    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    const fileIds: string[] = [];

    const messages: unknown[] = opts.messages.map((m) => ({ role: m.role, content: toContentBlocks(m) }));

    const base: Record<string, unknown> = {
      model: opts.modelId,
      max_tokens: opts.maxTokens,
      system: opts.system,
    };
    if (useFileTools) {
      base.betas = FILE_TOOL_BETAS;
      base.container = { skills: FILE_SKILLS.map((id) => ({ type: "anthropic", skill_id: id, version: "latest" })) };
      base.tools = [{ type: "code_execution_20260521", name: "code_execution" }];
    }

    try {
      // サーバー側ツールが上限に達すると pause_turn で一旦返るので、続きを促して回す。
      for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
        const message = await runOnce(client, { ...base, messages }, useFileTools, opts.signal, opts.onDelta);

        inputTokens += message.usage?.input_tokens ?? 0;
        outputTokens += message.usage?.output_tokens ?? 0;
        stopReason = message.stop_reason ?? null;
        if (useFileTools) fileIds.push(...collectFileIds(message.content as unknown[]));

        if (stopReason !== "pause_turn") break;
        // 再開は「同じ会話にアシスタント発言を積んで投げ直す」だけ。追加の指示は入れない。
        messages.push({ role: "assistant", content: message.content });
      }
    } catch (e) {
      throw toApiError(e);
    }

    // 安全機構による拒否は HTTP 200 で返る。本文が空のまま成功扱いにすると
    // 受講者には「無言の空欄」に見えるので、理由の分かるエラーとして扱う。
    if (stopReason === "refusal") throw new LabProviderError("refused");

    const files: GeneratedFile[] = [];
    for (const id of Array.from(new Set(fileIds))) {
      try {
        const meta = await client.beta.files.retrieveMetadata(id, { betas: ["files-api-2025-04-14"] });
        const res = await client.beta.files.download(id, { betas: ["files-api-2025-04-14"] });
        const fileName = (meta as { filename?: string }).filename ?? "output";
        files.push({
          fileName,
          mime: mimeForFile(fileName),
          data: Buffer.from(await res.arrayBuffer()),
        });
      } catch {
        // 1件の取得失敗で回答ごと失わせない。取れたファイルだけ返す。
      }
    }

    return { inputTokens, outputTokens, files };
  },
};
