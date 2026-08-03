import {
  getConversation,
  getPreset,
  labDb,
  listAssets,
  listMessages,
  monthlyTokensUsed,
  recentUserMessageCount,
  type LabConversationRow,
} from "./db";
import { isBudgetExceeded, isRateLimited, monthRange } from "./limits";
import { resolveModel, type LabModel } from "./models";
import { buildHistory, buildSystemPrompt, type HistoryMessage } from "./prompt";
import { getLabCtx, type LabCtx } from "./session";
import { conversationTitleFrom } from "./validate";

/**
 * チャット/画像生成の共通前処理。
 *
 * 認可 → 利用制限 → 会話の解決/作成 → プロンプト組み立て までを1か所にまとめ、
 * テキストと画像の両ルートが同じ順序でチェックを通るようにしている
 * (片方だけ制限が抜ける、という事故を防ぐため)。
 */

export interface TurnError {
  code: string;
  status: number;
}

export interface PreparedTurn {
  ctx: LabCtx;
  model: LabModel;
  conversation: LabConversationRow;
  system: string;
  history: HistoryMessage[];
  userMessageId: string;
}

export interface TurnInput {
  slug: string;
  conversationId?: string | null;
  presetId?: string | null;
  modelKey: string;
  message: string;
}

export async function prepareLabTurn(
  input: TurnInput,
): Promise<{ ok: true; turn: PreparedTurn } | { ok: false; error: TurnError }> {
  const ctx = await getLabCtx(input.slug);
  if (!ctx) return { ok: false, error: { code: "unauthorized", status: 401 } };

  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: { code: "empty_message", status: 400 } };

  // 既存の会話は必ず本人のものとして引く(他人の会話IDを渡されても見つからない)。
  let conversation: LabConversationRow | null = null;
  if (input.conversationId) {
    conversation = await getConversation(ctx.user.id, input.conversationId);
    // 受講者が削除した会話への追記も塞ぐ(画面から消えたものが裏で伸びないように)。
    if (!conversation || conversation.is_archived) {
      return { ok: false, error: { code: "not_found", status: 404 } };
    }
  }

  // プリセットは会話に固定される。新規会話のときだけ指定を受け付ける。
  const presetId = conversation ? conversation.preset_id : (input.presetId ?? null);
  const preset = presetId ? await getPreset(ctx.company.id, presetId) : null;
  if (presetId && (!preset || !preset.is_active)) {
    return { ok: false, error: { code: "not_found", status: 404 } };
  }

  // プリセットがモデルを固定している場合は、受講者の指定より優先する。
  const requestedKey = preset?.model_key ?? input.modelKey;
  const model = resolveModel(requestedKey);
  const allowed = ctx.models.some((m) => m.key === requestedKey);
  if (!model || !allowed) return { ok: false, error: { code: "model_not_allowed", status: 400 } };

  const kind = model.kind === "image" ? "image" : "text";
  const recent = await recentUserMessageCount(ctx.user.id, kind);
  if (isRateLimited(recent, kind)) return { ok: false, error: { code: "rate_limited", status: 429 } };

  if (ctx.company.monthly_token_budget != null) {
    const { from, to } = monthRange();
    const used = await monthlyTokensUsed(ctx.company.id, from, to);
    if (isBudgetExceeded(used, ctx.company.monthly_token_budget)) {
      return { ok: false, error: { code: "budget_exceeded", status: 403 } };
    }
  }

  const db = labDb();

  if (!conversation) {
    const { data, error } = await db
      .from("ai_lab_conversations")
      .insert({
        tenant_id: ctx.company.tenant_id,
        company_id: ctx.company.id,
        user_id: ctx.user.id,
        preset_id: preset?.id ?? null,
        title: conversationTitleFrom(message),
        last_model_key: model.key,
      })
      .select("id, company_id, user_id, preset_id, title, last_model_key, is_archived, created_at, updated_at")
      .single();
    if (error || !data) return { ok: false, error: { code: "provider_error", status: 500 } };
    conversation = data as LabConversationRow;
  }

  const { data: inserted, error: msgError } = await db
    .from("ai_lab_messages")
    .insert({
      tenant_id: ctx.company.tenant_id,
      company_id: ctx.company.id,
      conversation_id: conversation.id,
      user_id: ctx.user.id,
      role: "user",
      content: message,
      model_key: model.key,
    })
    .select("id")
    .single();
  if (msgError || !inserted) return { ok: false, error: { code: "provider_error", status: 500 } };

  const assets = preset ? await listAssets(ctx.company.id, preset.id) : [];
  const { system } = buildSystemPrompt(preset, assets);

  const all = await listMessages(conversation.id);
  const history = buildHistory(
    all.map((m) => ({ role: m.role, content: m.content })),
  );

  return {
    ok: true,
    turn: { ctx, model, conversation, system, history, userMessageId: inserted.id as string },
  };
}

/** アシスタントの発言を記録し、会話の更新時刻・最終モデルを合わせる。 */
export async function saveAssistantMessage(params: {
  turn: PreparedTurn;
  content: string;
  inputTokens: number;
  outputTokens: number;
  imagePaths?: string[];
  errorCode?: string | null;
}): Promise<string | null> {
  const { turn } = params;
  const db = labDb();
  const { data } = await db
    .from("ai_lab_messages")
    .insert({
      tenant_id: turn.ctx.company.tenant_id,
      company_id: turn.ctx.company.id,
      conversation_id: turn.conversation.id,
      user_id: turn.ctx.user.id,
      role: "assistant",
      content: params.content,
      model_key: turn.model.key,
      provider: turn.model.provider,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      image_paths: params.imagePaths ?? null,
      error_code: params.errorCode ?? null,
    })
    .select("id")
    .single();

  await db
    .from("ai_lab_conversations")
    .update({ last_model_key: turn.model.key, updated_at: new Date().toISOString() })
    .eq("id", turn.conversation.id);

  return (data?.id as string) ?? null;
}
