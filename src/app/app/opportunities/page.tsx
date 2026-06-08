import { Plus } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { getLeadSources, getProducts, listMembers, listOpportunities, listCampaigns } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { OppTable } from "@/components/opportunities/opp-table";

export default async function OpportunitiesPage() {
  const ws = await getWorkspace();
  const opps = listOpportunities(ws);
  const owners = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const products = getProducts(ws).map((p) => ({ id: p.id, name: p.name }));
  const sources = getLeadSources(ws).map((s) => ({ id: s.id, name: s.name }));
  const campaigns = listCampaigns(ws).map((c) => ({ id: c.id, name: c.name }));

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
      <OppTable opps={opps} owners={owners} products={products} sources={sources} campaigns={campaigns} />
    </div>
  );
}
