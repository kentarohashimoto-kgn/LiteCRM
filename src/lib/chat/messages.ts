import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P4: メッセージイベント（google.workspace.chat.message.v1.created）の処理。
 * Bot が参加しているスペースの会話を chat_messages に蓄積し、
 * AI（PMO等）のプロンプトへ「社内チャットの文脈」として注入できるようにする。
 * 冪等性は chat_event_log（Pub/Sub messageId）+ chat_messages.unique(message_name) の二段構え。
 */

export interface MessageExtract {
  messageName: string; // "spaces/X/messages/Y"
  spaceName: string; // "spaces/X"
  threadName: string | null;
  senderChatUserId: string | null; // "users/123"
  senderIsBot: boolean;
  text: string;
  createTime: string | null; // RFC3339
}

/** payload の揺れを吸収してメッセージ情報を取り出す（extractReaction と同方針）。 */
export function extractMessageCreated(payload: any): MessageExtract | null {
  const msg = payload?.message ?? payload?.data?.message ?? payload?.chat?.message;
  if (!msg) return null;
  const messageName: string | undefined = msg.name;
  if (!messageName) return null;
  const spaceName = msg.space?.name ?? messageName.replace(/\/messages\/.*$/, "");
  const text = ((msg.text ?? msg.formattedText ?? "") as string).trim();
  return {
    messageName,
    spaceName,
    threadName: (msg.thread?.name as string | undefined) ?? null,
    senderChatUserId: (msg.sender?.name as string | undefined) ?? null,
    senderIsBot: msg.sender?.type === "BOT",
    text,
    createTime: (msg.createTime as string | undefined) ?? null,
  };
}

export interface MessageHandleResult {
  status: "stored" | "skipped";
  detail?: string;
}

/**
 * メッセージ作成イベントを chat_messages に保存する。
 * - Bot 自身の投稿（通知等）は蓄積しない（AIソースを汚さない）。
 * - テナントは chat_space_bindings（アクティブなスペース紐付け）から解決。
 * - 送信者は chat_identities に既存の紐付けがあれば CRM ユーザーに解決（無ければ null のまま保存）。
 */
export async function handleMessageCreated(payload: any): Promise<MessageHandleResult> {
  const ext = extractMessageCreated(payload);
  if (!ext) return { status: "skipped", detail: "no message in payload" };
  if (ext.senderIsBot) return { status: "skipped", detail: "bot message" };
  if (!ext.text) return { status: "skipped", detail: "empty text" };

  const admin = getSupabaseAdmin();
  const { data: bindings } = await admin
    .from("chat_space_bindings")
    .select("tenant_id")
    .eq("space_name", ext.spaceName)
    .eq("is_active", true);
  if (!bindings || bindings.length === 0) {
    return { status: "skipped", detail: "space not bound to tenant" };
  }

  let stored = 0;
  for (const b of bindings) {
    const tenantId = b.tenant_id as string;
    let senderUserId: string | null = null;
    if (ext.senderChatUserId) {
      const { data: identity } = await admin
        .from("chat_identities")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("chat_user_id", ext.senderChatUserId)
        .maybeSingle();
      senderUserId = (identity?.user_id as string | undefined) ?? null;
    }
    const { error } = await admin.from("chat_messages").upsert(
      {
        tenant_id: tenantId,
        space_name: ext.spaceName,
        message_name: ext.messageName,
        thread_name: ext.threadName,
        sender_chat_user_id: ext.senderChatUserId,
        sender_user_id: senderUserId,
        text: ext.text.slice(0, 4000),
        create_time: ext.createTime,
      },
      { onConflict: "message_name", ignoreDuplicates: true },
    );
    if (!error) stored += 1;
  }
  return stored > 0 ? { status: "stored" } : { status: "skipped", detail: "insert failed" };
}

interface ChatLineRow {
  space_name: string;
  sender_user_id: string | null;
  text: string;
  create_time: string | null;
}

/** 会話行の整形（純粋関数・テスト用に分離）。JSTの日時 + スペース名 + 発言者 + 本文。 */
export function formatChatLines(
  rows: ChatLineRow[],
  spaceLabelOf: Map<string, string>,
  senderNameOf: Map<string, string>,
): string[] {
  return rows.map((r) => {
    const when = r.create_time
      ? new Date(new Date(r.create_time).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ")
      : "—";
    const space = spaceLabelOf.get(r.space_name) ?? r.space_name;
    const who = (r.sender_user_id ? senderNameOf.get(r.sender_user_id) : null) ?? "不明";
    return `- [${when} / ${space} / ${who}] ${r.text.replace(/\s+/g, " ").slice(0, 300)}`;
  });
}

/**
 * 直近の社内チャットをAIプロンプト用のテキストに整形する（AI-PMO等から呼ぶ）。
 * 蓄積が無ければ空文字（呼び出し側でセクションごと省略）。
 */
export async function gatherChatContext(
  sb: SupabaseClient,
  tenantId: string,
  opts?: { days?: number; limit?: number },
): Promise<string> {
  const days = opts?.days ?? 14;
  const limit = opts?.limit ?? 200;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await sb
    .from("chat_messages")
    .select("space_name, sender_user_id, text, create_time")
    .eq("tenant_id", tenantId)
    .gte("create_time", since)
    .order("create_time", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as ChatLineRow[];
  if (rows.length === 0) return "";

  // スペース表示名と発言者名を解決
  const spaceNames = Array.from(new Set(rows.map((r) => r.space_name)));
  const { data: spaces } = await sb
    .from("chat_space_bindings")
    .select("space_name, label")
    .eq("tenant_id", tenantId)
    .in("space_name", spaceNames);
  const spaceLabelOf = new Map<string, string>(
    ((spaces ?? []) as { space_name: string; label: string | null }[])
      .filter((s) => s.label)
      .map((s) => [s.space_name, s.label as string]),
  );

  const senderIds = Array.from(new Set(rows.map((r) => r.sender_user_id).filter((x): x is string => !!x)));
  const senderNameOf = new Map<string, string>();
  if (senderIds.length) {
    const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", senderIds);
    for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
      senderNameOf.set(p.id, p.display_name ?? p.email ?? "—");
    }
  }

  return (
    `# 社内チャット（Google Chat）の直近の会話（新しい順・直近${days}日・最大${limit}件）\n` +
    `以下は営業チームの実際の会話ログ。CRMデータと突き合わせ、商談の温度感・障害・決定事項・抜け漏れの把握に活用すること。\n` +
    formatChatLines(rows, spaceLabelOf, senderNameOf).join("\n")
  );
}
