import { PageHeader } from "@/components/ui/primitives";
import { ActivityForm } from "@/components/activities/activity-form";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { PickOption } from "@/server/actions/activities";

export const dynamic = "force-dynamic";

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: { account?: string; opp?: string };
}) {
  // 案件詳細/顧客詳細からの事前選択（?account=&opp=）を解決
  let defaultAccount: PickOption | undefined;
  let defaultOpp: PickOption | undefined;
  if (searchParams.account || searchParams.opp) {
    const sb = getSupabaseServer();
    if (searchParams.account) {
      const { data } = await sb.from("accounts").select("id,name,industry").eq("id", searchParams.account).maybeSingle();
      if (data) defaultAccount = { id: data.id, label: data.name ?? "—", sub: data.industry ?? undefined };
    }
    if (searchParams.opp) {
      const { data } = await sb.from("opportunities").select("id,name,yomi,account_id").eq("id", searchParams.opp).maybeSingle();
      if (data) {
        defaultOpp = { id: data.id, label: data.name ?? "—", sub: data.yomi ?? undefined };
        if (!defaultAccount && data.account_id) {
          const { data: a } = await sb.from("accounts").select("id,name,industry").eq("id", data.account_id).maybeSingle();
          if (a) defaultAccount = { id: a.id, label: a.name ?? "—", sub: a.industry ?? undefined };
        }
      }
    }
  }

  return (
    <div>
      <PageHeader title="活動を登録" subtitle="商談後5分以内の登録を推奨。次回アクションは必ず設定します。" />
      <ActivityForm defaultAccount={defaultAccount} defaultOpp={defaultOpp} />
    </div>
  );
}
