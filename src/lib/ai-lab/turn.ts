import {
  TEXT_MIMES,
  droppedNote,
  inlineTextAttachment,
  selectImageReferences,
  selectWithinBudget,
  validateMessageAttachments,
  type AttachmentRef,
  type SkippedReference,
} from "./attachments";
import {
  OUTPUT_BUCKET,
  attachToMessage,
  createAttachment,
  downloadAttachment,
  getConversation,
  getPendingAttachments,
  getPreset,
  labDb,
  listAssets,
  listAttachmentsForConversation,
  listMessages,
  monthlyTokensUsed,
  recentUserMessageCount,
  signAttachmentUrls,
  type LabAttachmentRow,
  type LabConversationRow,
} from "./db";
import { isBudgetExceeded, isRateLimited, monthRange } from "./limits";
import { resolveModel, type LabModel } from "./models";
import { FILE_TOOLS_NOTE, buildHistory, buildSystemPrompt } from "./prompt";
import type { ChatAttachment, ChatMessage, GeneratedFile, ImageReference } from "./providers/types";
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

/** 画像生成のときだけ組み立てる入力。 */
export interface ImageTurnInput {
  /** 本文＋テキスト添付を差し込んだ、モデルに渡すプロンプト。 */
  prompt: string;
  /** デザインガイド等の参照画像。 */
  references: ImageReference[];
  /** 参照に使えなかった添付と理由。 */
  skipped: SkippedReference[];
}

export interface PreparedTurn {
  ctx: LabCtx;
  model: LabModel;
  conversation: LabConversationRow;
  system: string;
  history: ChatMessage[];
  userMessageId: string;
  /** この会社でファイル生成(コード実行)を許可しているか。 */
  fileToolsEnabled: boolean;
  /** 画像生成のときだけ埋まる。テキスト生成では null。 */
  imageInput: ImageTurnInput | null;
}

export interface TurnInput {
  slug: string;
  conversationId?: string | null;
  presetId?: string | null;
  modelKey: string;
  message: string;
  /** アップロード済みで未送信の添付ID。 */
  attachmentIds?: string[];
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

  // 添付は「本人がアップロードした未送信のもの」だけを受け付ける。
  const requestedIds = input.attachmentIds ?? [];
  const pending = requestedIds.length
    ? await getPendingAttachments(ctx.company.id, ctx.user.id, requestedIds)
    : [];
  if (pending.length !== requestedIds.length) {
    return { ok: false, error: { code: "attachment_rejected", status: 400 } };
  }
  const sizeError = validateMessageAttachments(pending.map((a) => ({ size: Number(a.size_bytes) })));
  if (sizeError) return { ok: false, error: { code: "too_large", status: 413 } };

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

  const userMessageId = inserted.id as string;
  await attachToMessage(
    pending.map((a) => a.id),
    conversation.id,
    userMessageId,
  );

  const fileToolsEnabled = ctx.company.file_tools_enabled !== false && model.provider === "anthropic";
  const assets = preset ? await listAssets(ctx.company.id, preset.id) : [];
  const built = buildSystemPrompt(preset, assets);
  const system = fileToolsEnabled ? `${built.system}\n${FILE_TOOLS_NOTE}` : built.system;

  // 画像生成は会話履歴を送らない(プロンプト1本で作る)ので、履歴の組み立ては行わない。
  // 代わりに、参照として渡せる画像だけを集める。
  let history: ChatMessage[] = [];
  let imageInput: ImageTurnInput | null = null;
  if (model.kind === "image") {
    imageInput = await buildImageInput(conversation.id, message);
  } else {
    const all = await listMessages(conversation.id);
    const kept = buildHistory(all.map((m) => ({ id: m.id, role: m.role, content: m.content })));
    history = await attachFilesToHistory(conversation.id, kept);
  }

  return {
    ok: true,
    turn: {
      ctx,
      model,
      conversation,
      system,
      history,
      userMessageId,
      fileToolsEnabled,
      imageInput,
    },
  };
}

/**
 * 画像生成の入力を組み立てる。
 *
 * 会話中に添付された画像はすべて参照の候補にする。デザインガイドを1度渡したあと
 * 「もう少し明るく」と続けたときにも、ガイドが効き続けてほしいため。
 * 画像として渡せないもの(PDF・GIF等)は落とし、理由を呼び出し側へ返す。
 * テキスト添付は本文へ差し込む(トンマナをテキストで渡す使い方に対応する)。
 */
async function buildImageInput(conversationId: string, message: string): Promise<ImageTurnInput> {
  const all = await listAttachmentsForConversation(conversationId);
  const uploads = all.filter((a) => a.origin === "upload" && a.message_id);

  const textRows = uploads.filter((a) => (TEXT_MIMES as readonly string[]).includes(a.mime));
  const nonText = uploads.filter((a) => !(TEXT_MIMES as readonly string[]).includes(a.mime));

  const { used, skipped } = selectImageReferences(
    nonText.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      row,
    })),
  );

  const references: ImageReference[] = [];
  const failed: SkippedReference[] = [...skipped];
  for (const ref of used) {
    const buf = await downloadAttachment(ref.row);
    if (!buf) {
      failed.push({ fileName: ref.fileName, reason: "ファイルを読み込めませんでした" });
      continue;
    }
    references.push({ fileName: ref.fileName, mime: ref.mime, data: buf });
  }

  let prompt = message;
  for (const row of textRows) {
    const buf = await downloadAttachment(row);
    if (buf) prompt += inlineTextAttachment(row.file_name, buf.toString("utf8"));
  }

  return { prompt, references, skipped: failed };
}

/**
 * 履歴に添付を載せる。
 *
 * APIはステートレスなので、過去の添付も毎回送り直すことになる。
 * 全部送るとすぐ上限に当たるため、新しいものを優先して予算内に収め、
 * 落とした分はファイル名だけ本文に注記する(黙って消すと会話が噛み合わなくなる)。
 * 実体のダウンロードは、予算に残ったものだけに絞ってから行う。
 */
async function attachFilesToHistory(
  conversationId: string,
  kept: { id: string; role: "user" | "assistant"; content: string }[],
): Promise<ChatMessage[]> {
  const all = await listAttachmentsForConversation(conversationId);
  // 生成物(AIの出力)は入力として送り返さない。受講者が添付したものだけが対象。
  const uploads = all.filter((a) => a.origin === "upload" && a.message_id);
  if (uploads.length === 0) return kept.map((m) => ({ role: m.role, content: m.content }));

  const byMessage = new Map<string, LabAttachmentRow[]>();
  for (const a of uploads) {
    byMessage.set(a.message_id!, [...(byMessage.get(a.message_id!) ?? []), a]);
  }

  const refs: { messageId: string; attachments: (AttachmentRef & { row: LabAttachmentRow })[] }[] = kept.map((m) => ({
    messageId: m.id,
    attachments: (byMessage.get(m.id) ?? []).map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mime: row.mime,
      sizeBytes: Number(row.size_bytes),
      row,
    })),
  }));

  const budgeted = selectWithinBudget(refs);

  const out: ChatMessage[] = [];
  for (let i = 0; i < kept.length; i++) {
    const msg = kept[i];
    const slot = budgeted[i];
    let content = msg.content;
    const attachments: ChatAttachment[] = [];

    for (const ref of slot.attachments) {
      const row = ref.row;
      const buf = await downloadAttachment(row);
      if (!buf) {
        slot.droppedNames.push(row.file_name);
        continue;
      }
      if ((TEXT_MIMES as readonly string[]).includes(row.mime)) {
        content += inlineTextAttachment(row.file_name, buf.toString("utf8"));
      } else {
        attachments.push({
          kind: row.kind === "image" ? "image" : "document",
          mime: row.mime,
          fileName: row.file_name,
          data: buf.toString("base64"),
        });
      }
    }

    content += droppedNote(slot.droppedNames);
    out.push({ role: msg.role, content, attachments: attachments.length ? attachments : undefined });
  }
  return out;
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

/**
 * モデルが作ったファイル(xlsx等)を保存し、ダウンロード用の署名URLを返す。
 * 1件の保存失敗で回答ごと失わせないよう、成功したものだけを返す。
 */
export async function saveGeneratedFiles(
  turn: PreparedTurn,
  messageId: string | null,
  files: GeneratedFile[],
): Promise<{ id: string; fileName: string; mime: string; url: string }[]> {
  if (files.length === 0) return [];
  const db = labDb();
  const rows: LabAttachmentRow[] = [];

  for (const f of files) {
    const safeName = f.fileName.replace(/[^\w.\-]/g, "_") || "output";
    const path = `${turn.ctx.company.id}/${turn.conversation.id}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await db.storage
      .from(OUTPUT_BUCKET)
      .upload(path, f.data, { contentType: f.mime, upsert: false });
    if (error) continue;

    const row = await createAttachment({
      tenantId: turn.ctx.company.tenant_id,
      companyId: turn.ctx.company.id,
      userId: turn.ctx.user.id,
      origin: "generated",
      kind: "output",
      fileName: f.fileName,
      mime: f.mime,
      sizeBytes: f.data.length,
      storagePath: path,
      conversationId: turn.conversation.id,
      messageId,
    });
    if (row) rows.push(row);
  }

  const urls = await signAttachmentUrls(rows);
  return rows
    .filter((r) => urls[r.id])
    .map((r) => ({ id: r.id, fileName: r.file_name, mime: r.mime, url: urls[r.id] }));
}
