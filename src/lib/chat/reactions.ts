import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createMessage, getMessage } from "./client";
import { textMessage } from "./cards";
import { resolveAndUpsertSender, type ChatSender, type ResolvedSender } from "./identities";

/**
 * P3: リアクション（絵文字）イベントの処理。
 * Workspace Events の payload からリアクションを取り出し、
 * chat_reaction_triggers に照合してアクションを実行する。
 * 冪等性は呼び出し側が chat_event_log で担保（Pub/Subは重複配信あり）。
 */

export interface ReactionExtract {
  emoji: string;
  messageName: string; // "spaces/X/messages/Y"
  spaceName: string; // "spaces/X"
  sender: ChatSender;
}

/** payload の揺れを吸収してリアクション情報を取り出す。 */
export function extractReaction(payload: any): ReactionExtract | null {
  const reaction = payload?.reaction ?? payload?.data?.reaction ?? payload?.chat?.reaction;
  if (!reaction) return null;
  const emoji: string | undefined = reaction.emoji?.unicode ?? reaction.emoji?.customEmoji?.uid;
  // reaction.name: "spaces/X/messages/Y/reactions/Z"
  const rn: string | undefined = reaction.name;
  const messageName = rn ? rn.replace(/\/reactions\/.*$/, "") : reaction.message?.name;
  if (!emoji || !messageName) return null;
  const spaceName = messageName.replace(/\/messages\/.*$/, "");
  const sender: ChatSender = reaction.user
    ? { name: reaction.user.name, email: reaction.user.email, displayName: reaction.user.displayName }
    : {};
  return { emoji, messageName, spaceName, sender };
}

interface TriggerRow {
  emoji: string;
  scope: string;
  space_name: string | null;
  message_kind: string | null;
  action: string;
  action_args: Record<string, unknown>;
}

/** 反応対象メッセージの messageKind（カードIDに埋めたタグ）を取得。 */
async function fetchMessageKind(messageName: string): Promise<string | null> {
  try {
    const msg = await getMessage(messageName);
    const cardId: string | undefined = msg?.cardsV2?.[0]?.cardId;
    if (cardId && cardId.startsWith("kind:")) return cardId.slice("kind:".length);
  } catch {
    /* 取得失敗は無視 */
  }
  return null;
}

function jstPlusDays(days: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 単一アクションを実行し、ユーザー向けの短い結果文を返す。 */
async function runAction(
  action: string,
  sender: ResolvedSender,
  ext: ReactionExtract,
): Promise<string> {
  const admin = getSupabaseAdmin();
  switch (action) {
    case "create_task": {
      const title = `Chatリアクション対応（${ext.emoji}）`;
      const { error } = await admin.from("tasks").insert({
        tenant_id: sender.tenantId,
        assigned_to: sender.userId,
        created_by: sender.userId,
        title,
        due_date: jstPlusDays(1),
        status: "todo",
        priority: "middle",
        origin: "chat_reaction",
      });
      return error ? `タスク作成に失敗: ${error.message}` : "フォロータスクを起票しました（期限=明日）。";
    }
    case "mark_reviewed":
      // 現状は受領記録のみ（将来: 対象アラートのスヌーズ/クローズに拡張）。
      return "確認済みとして受け付けました。";
    case "assign_me":
      return "担当アサインを受け付けました（対象商談の紐付けは今後対応）。";
    case "escalate":
      return "エスカレーションを受け付けました（マネージャー通知は今後対応）。";
    default:
      return `未知のアクション: ${action}`;
  }
}

export interface ReactionHandleResult {
  status: "processed" | "skipped";
  detail?: string;
}

/** リアクション作成イベントを処理（照合→実行→スペースに結果返信）。 */
export async function handleReactionCreated(payload: any): Promise<ReactionHandleResult> {
  const ext = extractReaction(payload);
  if (!ext) return { status: "skipped", detail: "no reaction in payload" };

  const sender = await resolveAndUpsertSender(ext.sender);
  if (!sender) return { status: "skipped", detail: "sender not mapped to CRM user" };

  const admin = getSupabaseAdmin();
  const { data: triggers } = await admin
    .from("chat_reaction_triggers")
    .select("emoji, scope, space_name, message_kind, action, action_args")
    .eq("tenant_id", sender.tenantId)
    .eq("emoji", ext.emoji)
    .eq("is_active", true);

  const rows = (triggers ?? []) as TriggerRow[];
  if (rows.length === 0) return { status: "skipped", detail: `no trigger for ${ext.emoji}` };

  // message_kind スコープがあるものは、対象メッセージのタグを取得して照合。
  const needsKind = rows.some((r) => r.scope === "message_kind");
  const kind = needsKind ? await fetchMessageKind(ext.messageName) : null;

  const matched = rows.filter((r) => {
    if (r.scope === "space") return r.space_name === ext.spaceName;
    if (r.scope === "message_kind") return r.message_kind === kind;
    return true; // 'any'
  });
  if (matched.length === 0) return { status: "skipped", detail: "no scoped trigger matched" };

  const results: string[] = [];
  for (const t of matched) results.push(await runAction(t.action, sender, ext));

  // 結果をスペースにスレッド返信（best-effort）。
  try {
    const who = sender.displayName ? `${sender.displayName} さん` : "";
    await createMessage(ext.spaceName, textMessage(`${ext.emoji} ${who}: ${results.join(" / ")}`));
  } catch {
    /* 返信失敗は無視 */
  }
  return { status: "processed", detail: results.join(" / ") };
}
