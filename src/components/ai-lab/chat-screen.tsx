import { notFound } from "next/navigation";
import {
  getConversation,
  listActivePresets,
  listAttachmentsForConversation,
  listConversations,
  listMessages,
  signAttachmentUrls,
  signImageUrlMap,
} from "@/lib/ai-lab/db";
import { requireLabCtx } from "@/lib/ai-lab/session";
import type { LabUiFile, LabUiMessage, LabUiPreset } from "@/lib/ai-lab/ui-types";
import { ChatClient } from "./chat-client";
import { LabShell } from "./lab-shell";

/**
 * チャット画面のサーバー側組み立て。
 * 「新規チャット」と「既存会話」で必要なデータがほぼ同じなので、両ページから共有する。
 */
export async function ChatScreen({
  slug,
  conversationId,
}: {
  slug: string;
  conversationId: string | null;
}) {
  const ctx = await requireLabCtx(slug);

  const [conversations, presetRows] = await Promise.all([
    listConversations(ctx.user.id),
    listActivePresets(ctx.company.id),
  ]);

  const presets: LabUiPreset[] = presetRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    modelKey: p.model_key,
  }));

  let messages: LabUiMessage[] = [];
  let activePreset: LabUiPreset | null = null;

  if (conversationId) {
    const conv = await getConversation(ctx.user.id, conversationId);
    // 他人の会話・削除済みの会話は「存在しない」として扱う。
    if (!conv || conv.is_archived) notFound();

    const rows = await listMessages(conv.id);
    const attachmentRows = await listAttachmentsForConversation(conv.id);
    const [signed, attachmentUrls] = await Promise.all([
      signImageUrlMap(rows.flatMap((r) => r.image_paths ?? [])),
      signAttachmentUrls(attachmentRows),
    ]);

    const toUiFile = (a: (typeof attachmentRows)[number]): LabUiFile => ({
      id: a.id,
      fileName: a.file_name,
      mime: a.mime,
      url: attachmentUrls[a.id] ?? "",
    });
    const byMessage = new Map<string, typeof attachmentRows>();
    for (const a of attachmentRows) {
      if (!a.message_id) continue;
      byMessage.set(a.message_id, [...(byMessage.get(a.message_id) ?? []), a]);
    }

    messages = rows.map((r) => {
      const files = byMessage.get(r.id) ?? [];
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        modelKey: r.model_key,
        images: (r.image_paths ?? []).map((p) => signed[p]).filter(Boolean),
        // 署名に失敗したものは表示しない(リンク切れを出さない)。
        attachments: files.filter((a) => a.origin === "upload").map(toUiFile).filter((f) => f.url),
        files: files.filter((a) => a.origin === "generated").map(toUiFile).filter((f) => f.url),
        errorCode: r.error_code,
      };
    });
    activePreset = conv.preset_id ? (presets.find((p) => p.id === conv.preset_id) ?? null) : null;
  }

  return (
    <LabShell
      slug={slug}
      companyName={ctx.company.name}
      displayName={ctx.user.display_name}
      conversations={conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }))}
      activeId={conversationId}
    >
      <ChatClient
        slug={slug}
        companyName={ctx.company.name}
        conversationId={conversationId}
        initialMessages={messages}
        models={ctx.models.map((m) => ({ key: m.key, label: m.label, hint: m.hint, kind: m.kind }))}
        defaultModel={ctx.defaultModel}
        presets={presets}
        activePreset={activePreset}
      />
    </LabShell>
  );
}
