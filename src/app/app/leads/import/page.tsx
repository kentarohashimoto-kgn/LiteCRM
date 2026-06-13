import { getWorkspace } from "@/lib/data/workspace";
import { listCampaigns, getLeadSources } from "@/lib/data/select";
import { PageHeader } from "@/components/ui/primitives";
import { ImportForm } from "@/components/leads/import-form";

export default async function LeadImportPage() {
  const ws = await getWorkspace();
  const campaigns = listCampaigns(ws)
    .slice()
    .sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? ""))
    .map((c) => ({ id: c.id, name: c.name, event_date: c.event_date }));
  const leadSources = getLeadSources(ws).map((s) => ({ id: s.id, name: s.name }));

  return (
    <div>
      <PageHeader
        title="リード取込"
        subtitle="展示会・セミナーのTSV/CSVをアップロード。列を対応づけて一括投入します（形式が変わっても対応可）。"
      />
      <ImportForm campaigns={campaigns} leadSources={leadSources} />
    </div>
  );
}
