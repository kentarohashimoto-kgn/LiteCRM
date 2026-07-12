/**
 * ヨミ変更履歴(成約分析・失注分析のベースデータ)。
 * 記録はDBトリガー(0126)が全画面共通で自動実施。ここは閲覧用の取得のみ。
 * 可視範囲はRLS: 管理系=全件 / それ以外=自分の変更 or 自分担当案件。
 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { getMembersLite } from "@/lib/data/workspace";

export interface YomiLogRow {
  id: string;
  opportunityId: string;
  oppName: string;
  accountName: string;
  ownerUserId: string | null;
  ownerName: string;
  changedByName: string;
  changedAt: string;
  fromYomi: string | null;
  toYomi: string | null;
  reason: string | null;
  reasonRequired: boolean;
}

export async function getYomiHistory(days: number): Promise<YomiLogRow[]> {
  const sb = getSupabaseServer();
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const logR = await sb
    .from("yomi_change_logs")
    .select("id, opportunity_id, from_yomi, to_yomi, changed_by, changed_at, reason, reason_required")
    .gte("changed_at", since)
    .order("changed_at", { ascending: false })
    .limit(500);
  if (logR.error) throw new Error(`ヨミ変更履歴の取得に失敗: ${logR.error.message}`);
  const logs = (logR.data ?? []) as {
    id: string; opportunity_id: string; from_yomi: string | null; to_yomi: string | null;
    changed_by: string | null; changed_at: string; reason: string | null; reason_required: boolean;
  }[];
  if (logs.length === 0) return [];

  const oppIds = [...new Set(logs.map((l) => l.opportunity_id))];
  const [oppR, members] = await Promise.all([
    sb.from("opportunities").select("id, name, account_id, owner_user_id").in("id", oppIds),
    getMembersLite(),
  ]);
  if (oppR.error) throw new Error(`案件の取得に失敗: ${oppR.error.message}`);
  const opps = new Map(
    ((oppR.data ?? []) as { id: string; name: string; account_id: string | null; owner_user_id: string | null }[]).map((o) => [o.id, o]),
  );
  const accIds = [...new Set([...opps.values()].map((o) => o.account_id).filter((v): v is string => !!v))];
  const accR = accIds.length
    ? await sb.from("accounts").select("id, name").in("id", accIds)
    : { data: [], error: null };
  if (accR.error) throw new Error(`取引先の取得に失敗: ${accR.error.message}`);
  const accName = new Map(((accR.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
  const userName = new Map(members.map((m) => [m.user.id, m.user.name]));

  return logs.map((l) => {
    const o = opps.get(l.opportunity_id);
    return {
      id: l.id,
      opportunityId: l.opportunity_id,
      oppName: o?.name ?? "(削除済み案件)",
      accountName: o?.account_id ? accName.get(o.account_id) ?? "—" : "—",
      ownerUserId: o?.owner_user_id ?? null,
      ownerName: o?.owner_user_id ? userName.get(o.owner_user_id) ?? "—" : "—",
      changedByName: l.changed_by ? userName.get(l.changed_by) ?? "—" : "システム",
      changedAt: l.changed_at,
      fromYomi: l.from_yomi,
      toYomi: l.to_yomi,
      reason: l.reason,
      reasonRequired: l.reason_required,
    };
  });
}
