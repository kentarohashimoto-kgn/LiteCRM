import Link from "next/link";
import { PenSquare, History } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/primitives";
import { ScheduledList } from "@/components/email/scheduled-list";
import { listScheduledEmailsAction } from "@/server/actions/mail-schedule";

export const dynamic = "force-dynamic";

/**
 * 予約送信の一覧(0179)。指定時刻に /api/cron/scheduled-mail が本人アカウントで送信する。
 * 送信前ならキャンセル・日時変更が可能(本人分のみ)。
 */
export default async function ScheduledMailPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  const [rows, profR] = await Promise.all([
    listScheduledEmailsAction(),
    sb.from("profiles").select("id, display_name, email"),
  ]);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const senderNames: Record<string, string> = Object.fromEntries(
    ((profR.data ?? []) as any[]).map((p) => [p.id as string, (p.display_name as string) || (p.email as string) || ""]),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div>
      <PageHeader
        title="予約送信"
        subtitle="「送信日時を指定」で予約したメールの一覧です。送信前ならキャンセル・日時変更ができます。"
        action={
          <div className="flex items-center gap-2">
            <Link href="/app/email/compose" className="btn-accent inline-flex items-center gap-1 text-sm"><PenSquare size={14} /> メールを作成</Link>
            <Link href="/app/email/history" className="btn-ghost inline-flex items-center gap-1 text-sm text-ink/70"><History size={14} /> 送信履歴</Link>
          </div>
        }
      />
      <ScheduledList rows={rows} senderNames={senderNames} />
    </div>
  );
}
