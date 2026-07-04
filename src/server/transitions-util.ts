/**
 * 研修/開発案件が受注(won)になった時にトランジションを自動作成し、
 * 標準フォロータスク(御礼/定着MTG/お土産/顧問化)を生成する。冪等（重複作成しない）。
 * ※ "use server" ではない共有サーバーユーティリティ（各アクションから呼ぶ）。
 */
import { getSupabaseServer } from "@/lib/supabase/server";

function addDays(base: Date, days: number, biz?: boolean): string {
  const d = new Date(base);
  if (!biz) {
    d.setDate(d.getDate() + days);
  } else {
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) added++;
    }
  }
  return d.toISOString().slice(0, 10);
}

export async function ensureTransitionOnWon(tenantId: string, userId: string, oppId: string): Promise<void> {
  const sb = getSupabaseServer();
  const { data: opp } = await sb
    .from("opportunities")
    .select("id,account_id,category")
    .eq("id", oppId)
    .maybeSingle();
  if (!opp || !opp.account_id) return;
  const cat = opp.category as string | null;
  if (cat !== "training" && cat !== "development") return;

  const { data: existing } = await sb.from("transitions").select("id").eq("original_opportunity_id", oppId).limit(1);
  if (existing && existing.length) return;

  const { error } = await sb.from("transitions").insert({
    tenant_id: tenantId,
    account_id: opp.account_id,
    original_opportunity_id: oppId,
    initial_product: cat,
    status: "active",
  });
  if (error) return; // unique制約違反など＝既に存在。冪等に無視。

  const today = new Date();
  const defs = [
    { d: addDays(today, 3, true), t: "御礼・アンケート要約・成果サマリー送付" },
    { d: addDays(today, 14), t: "活用定着MTG" },
    { d: addDays(today, 30), t: "お土産提案（eラーニング/回答AI/SUISHIN）" },
    { d: addDays(today, 90), t: "部署展開・全社展開・顧問化提案" },
  ];
  await sb.from("tasks").insert(
    defs.map((x) => ({
      tenant_id: tenantId,
      opportunity_id: oppId,
      account_id: opp.account_id,
      assigned_to: userId,
      created_by: userId,
      title: x.t,
      description: "研修後トランジションによる自動作成",
      due_date: x.d,
      status: "todo",
      priority: "middle",
      origin: "transition",
    })),
  );
}
