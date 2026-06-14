import { Plus } from "lucide-react";
import { getWorkspaceLite } from "@/lib/data/workspace";
import { getLeadSources, getProducts, listMembers, listOpportunities, listCampaigns } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { OppViews } from "@/components/opportunities/opp-views";

export default async function OpportunitiesPage() {
  const ws = await getWorkspaceLite();
  const opps = listOpportunities(ws);
  const owners = listMembers(ws).map(({ user }) => ({ id: user.id, name: user.name }));
  const products = getProducts(ws).map((p) => ({ id: p.id, name: p.name }));
  const sources = getLeadSources(ws).map((s) => ({ id: s.id, name: s.name }));
  const campaigns = listCampaigns(ws).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <PageHeader
        title="案件"
        subtitle="顧客 › 案件 › 商談。金額・ステージ・ヨミ・次アクションを案件単位で管理します。"
        action={
          <LinkButton href="/app/opportunities/new" variant="accent">
            <Plus size={16} /> 案件を作成
          </LinkButton>
        }
      />
      <OppViews opps={opps} owners={owners} products={products} sources={sources} campaigns={campaigns} />
    </div>
  );
}
