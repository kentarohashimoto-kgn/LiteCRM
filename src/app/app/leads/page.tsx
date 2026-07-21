import { Upload, Gauge } from "lucide-react";
import { rescoreAllLeadsAction } from "@/server/actions";
import {
  queryLeadList,
  queryCallQueue,
  getLeadsCompanies,
  getLeadsFunnel,
  getLeadsAnalysis,
  getLeadImportBatches,
  getAcquirerAliases,
  getLeadEvents,
  getExportPresets,
  getWebIntakeSources,
} from "@/lib/data/leads";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { LeadsWorkspace, type LeadsTab } from "@/components/leads/leads-workspace";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; ev?: string; disp?: string; rank?: string; page?: string; scored?: string };
}) {
  const tab = (["list", "inquiries", "funnel", "queue", "company", "analysis", "download", "batches"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "list") as LeadsTab;

  // 「HP問合せ」タブ用: 問い合わせフォーム由来(/api/lead-intake)の流入元を動的に取得。
  // ラベル(資料請求：〇〇・無料相談 等)が増えても description 判定で自動的に全て拾える。
  const inquirySources = tab === "inquiries" ? await getWebIntakeSources() : [];
  const inquirySourceNames = inquirySources.map((s) => s.name);
  // タブ内のサブ絞り込み(流入元)。実在する流入元名のみ受け付ける。
  const inquirySub = inquirySourceNames.includes(searchParams.ev ?? "") ? (searchParams.ev as string) : "";

  const filters = {
    q: searchParams.q ?? "",
    event: tab === "inquiries" ? inquirySub : searchParams.ev ?? "",
    disposition: searchParams.disp ?? "",
    rank: searchParams.rank ?? "",
    page: searchParams.page ? Math.max(1, parseInt(searchParams.page, 10) || 1) : 1,
    sourceIdIn: tab === "inquiries" ? inquirySources.map((s) => s.id) : undefined,
  };

  // アクティブなタブに必要なデータだけ取得する(全件ロードを避ける)。
  const list = tab === "list" || tab === "inquiries" ? await queryLeadList(filters) : undefined;
  const queue = tab === "queue" ? await queryCallQueue() : undefined;
  // 集計タブはSQL集計RPC(行を転送しない)。別名(エイリアス)の適用もSQL側で実施
  const company = tab === "company" ? await getLeadsCompanies() : undefined;
  const funnel = tab === "funnel" ? await getLeadsFunnel() : undefined;
  const aliasRows = tab === "analysis" ? await getAcquirerAliases() : [];
  const aliases = aliasRows.map((a) => ({ raw: a.raw, name: a.display_name ?? "" }));
  const analysis = tab === "analysis" ? await getLeadsAnalysis() : undefined;
  const events = tab === "list" || tab === "download" ? await getLeadEvents() : tab === "inquiries" ? inquirySourceNames : [];
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
        action={
          <div className="flex items-center gap-2">
            <form action={rescoreAllLeadsAction}>
              <button type="submit" className="btn-ghost inline-flex items-center gap-1.5" title="全リードをスコアリング(要件書4.10)。ランクは未設定のみ自動補完">
                <Gauge size={16} /> 再スコアリング
              </button>
            </form>
            <LinkButton href="/app/leads/import" variant="accent"><Upload size={16} /> 取込</LinkButton>
          </div>
        }
      />
      {searchParams.scored && (
        <div className="mb-4 rounded-lg border border-teal-primary/30 bg-teal-light/40 px-4 py-2.5 text-sm text-teal-deep">
          {searchParams.scored}件のリードをスコアリングしました（ランク未設定分は自動補完）。
        </div>
      )}
      <LeadsWorkspace
        tab={tab}
        list={list}
        funnel={funnel}
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
