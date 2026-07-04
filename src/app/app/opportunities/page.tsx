import { Plus } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { OppWorkspace } from "@/components/opportunities/opp-workspace";
import { leanToOppView, type OppsPage } from "@/lib/data/opps-page";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  await requireCtx();
  const sb = getSupabaseServer();
  // 初期ページ(50件)＋フィルタ用の小マスタのみ取得。全案件1.3MBの取得を回避。
  const [pageR, ownersR, productsR, sourcesR, campaignsR] = await Promise.all([
    sb.rpc("opportunities_page", { p_filter: {}, p_sort: "expected_close_date", p_asc: true, p_limit: 50, p_offset: 0 }),
    sb.from("profiles").select("id,display_name,email"),
    sb.from("products").select("id,name"),
    sb.from("lead_sources").select("id,name"),
    sb.from("campaigns").select("id,name,sort_order").order("sort_order"),
  ]);
  const page = (pageR.data ?? { rows: [], total: 0, sum_amount: 0, sum_weighted: 0 }) as OppsPage;
  const initialRows = page.rows.map(leanToOppView);
  const owners = (ownersR.data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) ?? (p.email as string) ?? "—" }));
  const products = (productsR.data ?? []).map((p) => ({ id: p.id as string, name: (p.name as string) ?? "—" }));
  const sources = (sourcesR.data ?? []).map((s) => ({ id: s.id as string, name: (s.name as string) ?? "—" }));
  const campaigns = (campaignsR.data ?? []).map((c) => ({ id: c.id as string, name: (c.name as string) ?? "—" }));

  return (
    <div>
      <PageHeader
        title="案件"
        subtitle="顧客 › 案件 › 商談。一覧はスクロールで追加読込。ヨミ・金額・次アクションはその場編集できます。"
        action={
          <LinkButton href="/app/opportunities/new" variant="accent">
            <Plus size={16} /> 案件を作成
          </LinkButton>
        }
      />
      <OppWorkspace
        initialRows={initialRows}
        initialTotal={page.total}
        initialSumAmount={page.sum_amount}
        initialSumWeighted={page.sum_weighted}
        owners={owners}
        products={products}
        sources={sources}
        campaigns={campaigns}
      />
    </div>
  );
}
