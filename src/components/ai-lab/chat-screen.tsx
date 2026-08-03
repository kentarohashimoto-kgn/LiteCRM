import { notFound } from "next/navigation";
import {
  getConversation,
  listActivePresets,
  listConversations,
  listMessages,
  signImageUrlMap,
} from "@/lib/ai-lab/db";
import { requireLabCtx } from "@/lib/ai-lab/session";
import type { LabUiMessage, LabUiPreset } from "@/lib/ai-lab/ui-types";
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
    const signed = await signImageUrlMap(rows.flatMap((r) => r.image_paths ?? []));
    messages = rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      modelKey: r.model_key,
      images: (r.image_paths ?? []).map((p) => signed[p]).filter(Boolean),
      errorCode: r.error_code,
    }));
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
