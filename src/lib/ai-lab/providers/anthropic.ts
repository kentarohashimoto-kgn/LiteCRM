import Anthropic from "@anthropic-ai/sdk";
import {
  LabProviderError,
  isAbortError,
  type ChatProvider,
  type ChatStreamOptions,
  type ChatUsage,
} from "./types";

/**
 * Claude(Anthropic)のストリーミング。
 * エラー区分は既存の src/server/actions/ai.ts と同じ考え方に揃えている。
 */
export const anthropicChat: ChatProvider = {
  async stream(opts: ChatStreamOptions): Promise<ChatUsage> {
    if (!process.env.ANTHROPIC_API_KEY) throw new LabProviderError("config_error", "ANTHROPIC_API_KEY が未設定です");

    const client = new Anthropic();
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = await client.messages.create(
        {
          model: opts.modelId,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        },
        { signal: opts.signal },
      );

      for await (const event of stream) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage?.input_tokens ?? 0;
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          opts.onDelta(event.delta.text);
        } else if (event.type === "message_delta") {
          outputTokens = event.usage?.output_tokens ?? outputTokens;
        }
      }
    } catch (e) {
      if (isAbortError(e)) throw new LabProviderError("aborted");
      if (e instanceof Anthropic.AuthenticationError) throw new LabProviderError("config_error", "APIキーが無効です");
      if (e instanceof Anthropic.RateLimitError) throw new LabProviderError("rate_limited");
      if (e instanceof Anthropic.APIError) throw new LabProviderError("provider_error", `Anthropic API エラー(${e.status})`);
      throw new LabProviderError("provider_error", "Anthropic への接続に失敗しました");
    }

    return { inputTokens, outputTokens };
  },
};
