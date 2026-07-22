import type { getSupabaseServer } from "@/lib/supabase/server";

type SB = ReturnType<typeof getSupabaseServer>;

export type MeetingNextActionInput = {
  tenantId: string;
  oppId: string;
  meetingId: string;
  accountId?: string | null;
  ownerId: string;
  createdBy: string;
  /** 次アクション日（空/NULL なら、この商談発のネクストアクションを消す）。 */
  date: string | null;
  /** 次アクション内容。 */
  text: string | null;
};

/**
 * 商談に紐づくネクストアクション（tasks.origin='next_action' / source_meeting_id=商談）を
 * 1件だけ upsert する。案件のネクストアクションは複数持てるが、1商談につき1件に保つ。
 *  - date あり: その商談発のオープンなタスクを更新、無ければ作成
 *  - date なし: その商談発のオープンなタスクを削除（ネクストアクション取り消し）
 * 案件カラム(opportunities.next_action_date/text)は触らない（あちらは手動/主ネクストの枠）。
 */
export async function upsertMeetingNextAction(sb: SB, p: MeetingNextActionInput): Promise<void> {
  const title = (p.text && p.text.trim()) || "次回アクション";

  const { data: existing } = await sb
    .from("tasks")
    .select("id")
    .eq("opportunity_id", p.oppId)
    .eq("origin", "next_action")
    .eq("source_meeting_id", p.meetingId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!p.date) {
    if (existing?.id) await sb.from("tasks").delete().eq("id", existing.id);
    return;
  }

  if (existing?.id) {
    await sb
      .from("tasks")
      .update({ title, due_date: p.date, account_id: p.accountId ?? null, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await sb.from("tasks").insert({
      tenant_id: p.tenantId,
      opportunity_id: p.oppId,
      account_id: p.accountId ?? null,
      assigned_to: p.ownerId,
      created_by: p.createdBy,
      title,
      due_date: p.date,
      status: "todo",
      priority: "middle",
      origin: "next_action",
      source_meeting_id: p.meetingId,
    });
  }
}
