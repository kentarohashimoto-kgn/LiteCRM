import { Plus } from "lucide-react";
import { getCtx } from "@/lib/session";
import { getLeadSources, getMemberships, getProducts, getUser, listOpportunities } from "@/lib/data/store";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { OppTable } from "@/components/opportunities/opp-table";

export default function OpportunitiesPage() {
  const ctx = getCtx();
  const opps = listOpportunities(ctx);
  const owners = getMemberships(ctx)
    .map((m) => getUser(m.user_id))
    .filter(Boolean)
    .map((u) => ({ id: u!.id, name: u!.name }));
  const products = getProducts(ctx).map((p) => ({ id: p.id, name: p.name }));
  const sources = getLeadSources(ctx).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <PageHeader
        title="商談"
        subtitle="SFAの中核。金額・ステージ・ヨミ・次アクションを管理します。"
        action={
          <LinkButton href="/app/opportunities/new" variant="accent">
            <Plus size={16} /> 商談を作成
          </LinkButton>
        }
      />
      <OppTable opps={opps} owners={owners} products={products} sources={sources} />
    </div>
  );
}
