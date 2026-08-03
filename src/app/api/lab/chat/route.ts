import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { addUsage } from "@/lib/ai-lab/db";
import { getChatProvider, LabProviderError } from "@/lib/ai-lab/providers";
import { prepareLabTurn, saveAssistantMessage, saveGeneratedFiles } from "@/lib/ai-lab/turn";

/**
 * AI Lab のテキスト生成(SSEストリーミング)。
 *
 * Server Actions は逐次応答を返せないため、チャットだけ Route Handler にしている。
 * ストリームは素通しでバッファせず、届いた断片をそのまま SSE に流す。
 */

export const runtime = "nodejs";
// ファイル生成はコードを書いて実行する往復が入るぶん長くなる。
export const maxDuration = 300;

const MAX_OUTPUT_TOKENS = 8000;
/**
 * ファイル生成時はコードを書いて実行する往復が入るため、通常より広く取る。
 * ここが狭いと、複数シートを組み立てている途中で打ち切られて生成物が残らない。
 */
const MAX_OUTPUT_TOKENS_WITH_FILES = 24000;

export async function POST(req: NextRequest): Promise<Response> {
  let body: {
    slug?: string;
    conversationId?: string | null;
    presetId?: string | null;
    modelKey?: string;
    message?: string;
    attachmentIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "empty_message" }, { status: 400 });
  }

  const prep = await prepareLabTurn({
    slug: String(body.slug ?? ""),
    conversationId: body.conversationId ?? null,
    presetId: body.presetId ?? null,
    modelKey: String(body.modelKey ?? ""),
    message: String(body.message ?? ""),
    attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map(String) : [],
  });
  if (!prep.ok) return Response.json({ error: prep.error.code }, { status: prep.error.status });

  const turn = prep.turn;
  if (turn.model.kind !== "text") {
    return Response.json({ error: "model_not_allowed" }, { status: 400 });
  }

  // クライアントの切断・停止ボタンを生成側へ伝播させる。
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // 受信側が切断済み。生成の後始末は下の catch/finally で行う。
        }
      };

      // 新規会話のときはクライアントがURLを差し替えられるよう、最初にIDを送る。
      send({
        conversationId: turn.conversation.id,
        title: turn.conversation.title,
        modelKey: turn.model.key,
      });

      let text = "";
      try {
        const usage = await getChatProvider(turn.model).stream({
          modelId: turn.model.modelId(),
          system: turn.system,
          messages: turn.history,
          maxTokens: turn.fileToolsEnabled ? MAX_OUTPUT_TOKENS_WITH_FILES : MAX_OUTPUT_TOKENS,
          signal: abort.signal,
          // ファイル生成はコード実行を伴うため、会社設定で無効なら付けない。
          enableFileTools: turn.fileToolsEnabled,
          onDelta: (delta) => {
            text += delta;
            send({ delta });
          },
        });

        const messageId = await saveAssistantMessage({
          turn,
          content: text,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        const files = await saveGeneratedFiles(turn, messageId, usage.files ?? []);
        if (files.length > 0) send({ files });
        await addUsage({
          tenantId: turn.ctx.company.tenant_id,
          companyId: turn.ctx.company.id,
          userId: turn.ctx.user.id,
          modelKey: turn.model.key,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        send({ done: true, messageId });
      } catch (e) {
        const code = e instanceof LabProviderError ? e.code : "provider_error";
        // 停止・失敗どちらでも、そこまでの生成内容は残す(受講者の画面と履歴を一致させる)。
        await saveAssistantMessage({
          turn,
          content: text,
          inputTokens: 0,
          outputTokens: 0,
          errorCode: code,
        });
        if (code !== "aborted") Sentry.captureException(e);
        send({ error: code });
      } finally {
        try {
          controller.close();
        } catch {
          // 切断済みなら閉じるものがない。
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Vercel/プロキシ側でのバッファリングを抑止し、逐次描画を保つ。
      "x-accel-buffering": "no",
    },
  });
}
