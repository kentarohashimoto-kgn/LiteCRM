import {
  LabProviderError,
  isAbortError,
  type ChatProvider,
  type ChatStreamOptions,
  type ChatUsage,
  type GeneratedImage,
  type ImageProvider,
} from "./types";

/**
 * OpenAI(ChatGPT / gpt-image-2)への接続。
 *
 * 使うのは2エンドポイントだけなので、公式SDKを依存に足さず fetch で直接呼ぶ。
 * SDKのバージョン追従コストを持たない代わりに、レスポンス形式の前提をここに閉じ込める。
 */

const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new LabProviderError("config_error", "OPENAI_API_KEY が未設定です");
  return key;
}

function toLabError(status: number): LabProviderError {
  if (status === 401 || status === 403) return new LabProviderError("config_error", "APIキーが無効です");
  if (status === 429) return new LabProviderError("rate_limited");
  return new LabProviderError("provider_error", `OpenAI API エラー(${status})`);
}

/** SSE のバイト列を「data: 以降の1行」単位に切り出す。`[DONE]` は呼び出し側で判定する。 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onData: (payload: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // イベントは空行区切り。行の途中で切れることがあるので最後の断片は残す。
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) onData(rest.slice(5).trim());
}

export const openaiChat: ChatProvider = {
  async stream(opts: ChatStreamOptions): Promise<ChatUsage> {
    const key = apiKey();
    let inputTokens = 0;
    let outputTokens = 0;

    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opts.modelId,
          messages: [
            { role: "system", content: opts.system },
            ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
          // usage はストリーム最後のチャンクに載る。指定しないと取れない。
          stream_options: { include_usage: true },
        }),
        signal: opts.signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw new LabProviderError("aborted");
      throw new LabProviderError("provider_error", "OpenAI への接続に失敗しました");
    }

    if (!res.ok || !res.body) {
      if (!res.ok) throw toLabError(res.status);
      throw new LabProviderError("provider_error", "OpenAI から応答本文が得られませんでした");
    }

    try {
      await readSseStream(res.body, (payload) => {
        if (!payload || payload === "[DONE]") return;
        let json: {
          choices?: { delta?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          json = JSON.parse(payload);
        } catch {
          return; // 壊れた行は無視して継続する(生成は止めない)
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) opts.onDelta(delta);
        if (json.usage) {
          inputTokens = json.usage.prompt_tokens ?? inputTokens;
          outputTokens = json.usage.completion_tokens ?? outputTokens;
        }
      });
    } catch (e) {
      if (isAbortError(e)) throw new LabProviderError("aborted");
      throw new LabProviderError("provider_error", "OpenAI の応答受信中にエラーが発生しました");
    }

    return { inputTokens, outputTokens };
  },
};

export const openaiImage: ImageProvider = {
  async generate({ modelId, prompt, n, signal }): Promise<GeneratedImage[]> {
    const key = apiKey();
    let res: Response;
    try {
      res = await fetch(`${OPENAI_BASE}/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: modelId, prompt, n }),
        signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw new LabProviderError("aborted");
      throw new LabProviderError("provider_error", "OpenAI への接続に失敗しました");
    }
    if (!res.ok) throw toLabError(res.status);

    const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const items = json.data ?? [];
    const images: GeneratedImage[] = [];
    for (const item of items) {
      if (item.b64_json) {
        images.push({ data: Buffer.from(item.b64_json, "base64"), mime: "image/png" });
      } else if (item.url) {
        // 一部モデルはURL返却。保存して履歴から再表示できるよう、その場で取得する。
        const img = await fetch(item.url, { signal });
        if (!img.ok) continue;
        images.push({ data: Buffer.from(await img.arrayBuffer()), mime: img.headers.get("content-type") ?? "image/png" });
      }
    }
    if (images.length === 0) throw new LabProviderError("provider_error", "画像が生成されませんでした");
    return images;
  },
};
