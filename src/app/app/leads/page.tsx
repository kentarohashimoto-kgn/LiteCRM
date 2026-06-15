import { Upload } from "lucide-react";
import {
  queryLeadList,
  queryCallQueue,
  fetchLeadsForAggregation,
  getLeadImportBatches,
  getAcquirerAliases,
  getLeadEvents,
  getExportPresets,
} from "@/lib/data/leads";
import { buildCompanies, buildAnalysis } from "@/lib/data/leads-workspace";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { LeadsWorkspace, type LeadsTab } from "@/components/leads/leads-workspace";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; ev?: string; disp?: string; rank?: string; page?: string };
}) {
  const tab = (["list", "queue", "company", "analysis", "download", "batches"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "list") as LeadsTab;

  const filters = {
    q: searchParams.q ?? "",
    event: searchParams.ev ?? "",
    disposition: searchParams.disp ?? "",
    rank: searchParams.rank ?? "",
    page: searchParams.page ? Math.max(1, parseInt(searchParams.page, 10) || 1) : 1,
  };

  // アクティブなタブに必要なデータだけ取得する(全件ロードを避ける)。
  const list = tab === "list" ? await queryLeadList(filters) : undefined;
  const queue = tab === "queue" ? await queryCallQueue() : undefined;
  const company = tab === "company" ? buildCompanies(await fetchLeadsForAggregation()) : undefined;
  const aliasRows = tab === "analysis" ? await getAcquirerAliases() : [];
  const aliases = aliasRows.map((a) => ({ raw: a.raw, name: a.display_name ?? "" }));
  const analysis = tab === "analysis" ? buildAnalysis(await fetchLeadsForAggregation(), aliases) : undefined;
  const events = tab === "list" || tab === "download" ? await getLeadEvents() : [];
  const presets = tab === "download" ? (await getExportPresets()).map((p) => ({ id: p.id, name: p.name, columns: p.columns })) : [];
  const batchRows = tab === "batches" ? await getLeadImportBatches() : [];
  const batches = batchRows.map((b) => ({
    id: b.id,
    label: b.label ?? b.raw_event ?? "—",
    rawEvent: b.raw_event ?? "",
    sourceName: b.source_name ?? "",
    rowCount: b.row_count,
    createdAt: b.created_at,
    config: (b.config ?? {}) as Record<string, unknown>,
  }));

  return (
    <div>
      <PageHeader
        title="リード"
        subtitle="展示会・セミナーのリストを優先度付けし、架電→アポ獲得まで管理・分析します。"
        action={<LinkButton href="/app/leads/import" variant="accent"><Upload size={16} /> 取込</LinkButton>}
      />
      <LeadsWorkspace
        tab={tab}
        list={list}
        queue={queue}
        company={company}
        analysis={analysis}
        batches={batches}
        aliases={aliases}
        events={events}
        presets={presets}
        filters={filters}
      />
    </div>
  );
}
