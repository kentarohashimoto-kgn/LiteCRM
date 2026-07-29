import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { TemplatePreview, type TplRow } from "@/components/email/template-preview";
import { resolveSender } from "@/lib/sender";

export const dynamic = "force-dynamic";

/**
 * テンプレ対比プレビュー: 設定(テンプレ原文) ↔ 実際に届くメール を左右で見比べる。
 * 実践マニュアル(/help/lead-mail.html)の「どんなメールが送られるの？」から参照される。
 */
export default async function TemplatePreviewPage() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [{ data: tpls }, { data: acc }, { data: prof }] = await Promise.all([
    sb.from("email_templates").select("id, name, category, subject_tmpl, body_tmpl").order("category").order("name"),
    sb.from("user_mail_accounts").select("from_name, from_email, oauth_email, auth_method, signature").eq("user_id", ctx.userId).maybeSingle(),
    sb.from("profiles").select("display_name").eq("id", ctx.userId).maybeSingle(),
  ]);
  const senderVars = resolveSender({
    fromName: acc?.from_name as string | null,
    displayName: prof?.display_name as string | null,
    fromEmail: acc?.from_email as string | null,
    oauthEmail: acc?.oauth_email as string | null,
    authMethod: acc?.auth_method as string | null,
    signature: acc?.signature as string | null,
  });

  return (
    <div>
      <PageHeader
        title="テンプレ プレビュー（設定 ↔ 届くメールの対比）"
        subtitle="左がテンプレートの設定内容、右が相手の受信画面のイメージです。差し込み変数・計測リンク・配信停止フッターがどう変わるかを確認できます。"
        action={
          <Link href="/app/email/templates" className="btn-ghost inline-flex items-center gap-1 text-sm">
            <ChevronLeft size={15} /> テンプレート管理へ
          </Link>
        }
      />
      <TemplatePreview
        templates={(tpls ?? []) as TplRow[]}
        senderVars={senderVars}
      />
    </div>
  );
}
