import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { EmailComposer, type ComposerInitial } from "@/components/email/email-composer";
import type { EmailTemplate } from "@/app/app/email/templates/page";

export const dynamic = "force-dynamic";

/**
 * WO-20 メール作成(F-101a)。定型文→変数差込→Gmail作成画面で送信(手動)→記録。
 * ?opportunity=<id> / ?contact=<id> で宛先・案件を事前充填できる(案件詳細等からの導線用)。
 */
export default async function EmailComposePage({ searchParams }: { searchParams: { opportunity?: string; contact?: string } }) {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const [tplR, meR, acctR] = await Promise.all([
    sb.from("email_templates").select("id, name, category, subject_tmpl, body_tmpl").order("category").order("name"),
    sb.from("profiles").select("display_name, email").eq("id", ctx.userId).maybeSingle(),
    sb.from("user_mail_accounts").select("status, verified_at").maybeSingle(),
  ]);
  const templates = (tplR.data ?? []) as EmailTemplate[];
  const senderName = (meR.data?.display_name as string) || (meR.data?.email as string) || "";
  const hasMailAccount = acctR.data?.status === "active";

  const initial: ComposerInitial = { senderName };

  // 案件からの事前充填
  if (searchParams.opportunity) {
    const { data: opp } = await sb
      .from("opportunities")
      .select("id, name, account_id, accounts(name)")
      .eq("id", searchParams.opportunity)
      .maybeSingle();
    if (opp) {
      initial.opportunity = { id: opp.id as string, name: (opp.name as string) ?? "" };
      initial.accountId = (opp.account_id as string) ?? null;
      initial.company = ((opp.accounts as unknown as { name: string } | null)?.name as string) ?? null;
      // 案件顧客のメールを持つ担当者を1名だけ既定に
      if (opp.account_id) {
        const { data: c } = await sb
          .from("contacts")
          .select("id, name, email")
          .eq("account_id", opp.account_id)
          .not("email", "is", null)
          .limit(1)
          .maybeSingle();
        if (c) initial.contact = { id: c.id as string, name: (c.name as string) ?? "", email: (c.email as string) ?? null };
      }
    }
  }

  // 担当者からの事前充填
  if (!initial.contact && searchParams.contact) {
    const { data: c } = await sb
      .from("contacts")
      .select("id, name, email, account_id, accounts(name)")
      .eq("id", searchParams.contact)
      .maybeSingle();
    if (c) {
      initial.contact = { id: c.id as string, name: (c.name as string) ?? "", email: (c.email as string) ?? null };
      initial.accountId = (c.account_id as string) ?? null;
      initial.company = ((c.accounts as unknown as { name: string } | null)?.name as string) ?? null;
    }
  }

  return (
    <div>
      <PageHeader
        title="メールを作成"
        subtitle="定型文を選ぶと変数が自動で差し込まれます。「Gmailで開く」で送信画面が開き、内容を確認して送信。「記録する」でタイムラインに残ります。"
      />
      <EmailComposer templates={templates} initial={initial} hasMailAccount={hasMailAccount} />
    </div>
  );
}
