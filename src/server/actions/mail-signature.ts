"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * 送信者ごとの署名(0181)。テンプレの {signature} に差し込まれる。
 * 送信方式(SMTP / Google OAuth)によらず本人が編集できる。
 */
export async function saveMailSignatureAction(formData: FormData): Promise<void> {
  const ctx = await requireCtx();
  if (ctx.isPresentation) redirect("/app/email/account?error=forbidden");

  const signature = String(formData.get("signature") ?? "").slice(0, 2000);
  const sb = getSupabaseServer();
  const { data: acc } = await sb.from("user_mail_accounts").select("id").eq("user_id", ctx.userId).maybeSingle();
  if (!acc) redirect("/app/email/account?error=no_account");

  const { error } = await sb.from("user_mail_accounts").update({ signature }).eq("id", acc.id as string);
  if (error) redirect("/app/email/account?error=save_failed");

  revalidatePath("/app/email/account");
  revalidatePath("/app/email/templates/preview");
  redirect("/app/email/account?saved=signature");
}
