import Link from "next/link";
import { PenSquare, History, Plug, Repeat, BarChart3, Eye, Clock } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { TemplatesManager } from "@/components/email/templates-manager";

export const dynamic = "force-dynamic";

export interface EmailTemplate {
  id: string;
  name: string;
  category: string;
  subject_tmpl: string;
  body_tmpl: string;
}

/**
 * WO-20 メール定型文の管理(F-101a)。作成/編集/削除。
 * ここで整えた定型文をメール作成画面(/app/email/compose)から呼び出して使う。
 */
export default async function EmailTemplatesPage(props: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("email_templates")
    .select("id, name, category, subject_tmpl, body_tmpl")
    .order("category")
    .order("name");
  if (error) throw new Error(`定型文の取得に失敗: ${error.message}`);
  const templates = (data ?? []) as EmailTemplate[];
  const canEdit = !["viewer", "delivery", "finance", "back_office", "hr"].includes(ctx.role);

  return (
    <div>
      <PageHeader
        title="メール定型文"
        subtitle="お礼・資料送付・日程調整などの定型文を用意。メール作成画面から呼び出し、{contact}/{company} 等が自動で差し込まれます。"
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          created: "定型文を作成しました。",
          updated: "定型文を更新しました。",
          deleted: "定型文を削除しました。",
        }}
        errorMessages={{
          forbidden: "定型文の編集権限がありません。",
          invalid: "名称を入力してください。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/app/email/compose" className="btn-accent inline-flex items-center gap-1 text-sm">
          <PenSquare size={14} /> メールを作成する
        </Link>
        <Link href="/app/email/sequences" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <Repeat size={14} /> シーケンス
        </Link>
        <Link href="/app/email/analytics" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <BarChart3 size={14} /> 成果ダッシュボード
        </Link>
        <Link href="/app/email/history" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <History size={14} /> 送信履歴
        </Link>
        <Link href="/app/email/scheduled" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <Clock size={14} /> 予約送信
        </Link>
        <Link href="/app/email/segments" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <BarChart3 size={14} /> セグメント分析
        </Link>
        <Link href="/app/email/templates/preview" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <Eye size={14} /> 送信プレビュー（対比）
        </Link>
        <Link href="/app/email/account" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70">
          <Plug size={14} /> メール送信アカウント接続
        </Link>
      </div>

      <Section title="定型文">
        <TemplatesManager templates={templates} canEdit={canEdit} />
      </Section>
    </div>
  );
}
