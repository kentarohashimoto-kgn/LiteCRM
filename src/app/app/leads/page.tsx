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
  getWebIntakeMedia,
  getLeadAcquirers,
} from "@/lib/data/leads";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { LeadsWorkspace, type LeadsTab } from "@/components/leads/leads-workspace";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { tab?: string; q?: string; ev?: string; disp?: string; rank?: string; owner?: string; from?: string; to?: string; page?: string; scored?: string; md?: string; sort?: string; dir?: string };
}) {
  const tab = (["list", "inquiries", "funnel", "queue", "company", "analysis", "download", "batches"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "list") as LeadsTab;

  // 「HP問合せ」タブ用: 問い合わせフォーム由来(/api/lead-intake)の流入元を動的に取得。
  // ラベル(資料請求：〇〇・無料相談 等)が増えても description 判定で自動的に全て拾える。
  const [inquirySources, inquiryMedia] =
    tab === "inquiries" ? await Promise.all([getWebIntakeSources(), getWebIntakeMedia()]) : [[], [] as string[]];
  const inquirySourceNames = inquirySources.map((s) => s.name);
  // タブ内のサブ絞り込み。実在する流入詳細名/メディア名のみ受け付ける。
  const inquirySub = inquirySourceNames.includes(searchParams.ev ?? "") ? (searchParams.ev as string) : "";
  const inquiryMediaSel = inquiryMedia.includes(searchParams.md ?? "") ? (searchParams.md as string) : "";
  // 「HP問合せ」タブの並べ替え。既定は受付日時の新しい順。許可カラムのみ受け付ける。
  const SORTABLE = ["date", "media", "detail", "tags", "disposition"];
  const inquirySort = SORTABLE.includes(searchParams.sort ?? "") ? (searchParams.sort as string) : "date";
  const inquiryDir: "asc" | "desc" = searchParams.dir === "asc" ? "asc" : "desc";

  const filters = {
    q: searchParams.q ?? "",
    event: tab === "inquiries" ? inquirySub : searchParams.ev ?? "",
    disposition: searchParams.disp ?? "",
    rank: searchParams.rank ?? "",
    owner: searchParams.owner ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
    page: searchParams.page ? Math.max(1, parseInt(searchParams.page, 10) || 1) : 1,
    sourceIdIn: tab === "inquiries" ? inquirySources.map((s) => s.id) : undefined,
    media: tab === "inquiries" ? inquiryMediaSel : undefined,
    sort: tab === "inquiries" ? inquirySort : undefined,
    dir: tab === "inquiries" ? inquiryDir : undefined,
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
  // 社内担当者(取得担当)の選択肢。表記ゆれはSQL側(0176)で名寄せ済み
  const acquirers = tab === "list" ? (await getLeadAcquirers()).map((a) => ({ name: a.name, leads: a.leads })) : [];
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
            <LinkButton href="/app/leads/scoring" variant="ghost">
              <Gauge size={16} /> スコア設計
            </LinkButton>
            <form action={rescoreAllLeadsAction}>
              <button type="submit" className="btn-ghost inline-flex items-center gap-1.5" title="全リードを現在のルールでスコアリング。手動設定ランクは保持">
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
        acquirers={acquirers}
        mediaOptions={inquiryMedia}
        presets={presets}
        filters={filters}
      />
    </div>
  );
}
