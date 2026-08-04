import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import { modelLabel } from "@/lib/ai-lab/models";
import { formatDateTimeJst } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  model_key: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  image_paths: string[] | null;
  error_code: string | null;
  created_at: string;
}

/**
 * 会話ログの閲覧（管理者のみ・読み取り専用）。
 * 研修の振り返りに使う。受講者には「運営者が確認できる場合がある」旨をログイン画面で案内している。
 */
export default async function AiLabConversationLogPage(
  props: {
    params: Promise<{ companyId: string; conversationId: string }>;
  }
) {
  const params = await props.params;
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const { data: conv } = await sb
    .from("ai_lab_conversations")
    .select("id, title, user_id, is_archived, created_at, company_id")
    .eq("id", params.conversationId)
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (!conv) notFound();

  const [{ data: user }, messagesR] = await Promise.all([
    sb.from("ai_lab_users").select("display_name, login_id").eq("id", conv.user_id as string).maybeSingle(),
    sb
      .from("ai_lab_messages")
      .select("id, role, content, model_key, input_tokens, output_tokens, image_paths, error_code, created_at")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: true }),
  ]);
  const messages = (messagesR.data ?? []) as MessageRow[];

  return (
    <div>
      <PageHeader
        title={conv.title as string}
        subtitle={`${user?.display_name ?? "（削除済み）"} / ${formatDateTimeJst(conv.created_at as string)} 開始`}
        action={
          <Link href={`/app/ai-lab/${params.companyId}/usage`} className="btn-ghost inline-flex items-center gap-1.5">
            <ArrowLeft size={14} />
            利用状況へ戻る
          </Link>
        }
      />

      <Section title={`メッセージ（${messages.length}件）`}>
        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-3 ${
                m.role === "user" ? "border-teal-light bg-teal-light/20" : "border-black/[0.06] bg-white"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink/45">
                <span className="font-semibold">{m.role === "user" ? "受講者" : "AI"}</span>
                {m.model_key && <span>{modelLabel(m.model_key)}</span>}
                <span>{formatDateTimeJst(m.created_at)}</span>
                {(m.input_tokens || m.output_tokens) && (
                  <span className="tabular-nums">
                    in {m.input_tokens ?? 0} / out {m.output_tokens ?? 0}
                  </span>
                )}
                {m.image_paths?.length ? <span>画像 {m.image_paths.length}枚</span> : null}
              </div>
              {m.error_code ? (
                <p className="text-sm text-rose-600">
                  {m.error_code === "aborted" ? "（受講者が生成を停止）" : labErrorMessage(m.error_code)}
                  {m.content && <span className="mt-1 block whitespace-pre-wrap text-ink/70">{m.content}</span>}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-ink/90">{m.content || "（本文なし）"}</p>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
