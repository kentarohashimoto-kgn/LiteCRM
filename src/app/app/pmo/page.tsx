import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { formatManYen } from "@/lib/utils";
import { gatherPmoInput } from "@/lib/data/pmo";
import { detectPmoAlerts, isActiveYomi } from "@/lib/pmo";
import { PmoWorkspace, type PmoReportLite } from "@/components/pmo/pmo-workspace";

export const dynamic = "force-dynamic";

type ReportRow = {
  id: string;
  mode: string;
  title: string;
  report_md: string;
  model: string | null;
  created_at: string;
  digest: { trigger?: string } | null;
};

/**
 * AI-PMO: ベテランPMスーパーアドバイザー。
 * 鳥の目(俯瞰)・虫の目(詳細)・魚の目(トレンド)・コウモリの目(逆視点)で
 * 振り返りPDCA / 未来の段取り / 案件・PJ管理 / 経営俯瞰を支援する。
 * 画面は KPI + タブUI(レポート/ヌケモレ/新規生成)。レポートは左一覧・右詳細の
 * 2ペインで、選択はクライアント側で即時切替(ページ遷移せず縦スクロールも抑制)。
 */
export default async function PmoPage() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();

  const [input, reportsRes] = await Promise.all([
    gatherPmoInput(sb, ctx.tenantId),
    sb
      .from("pmo_reports")
      .select("id, mode, title, report_md, model, created_at, digest")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const alerts = detectPmoAlerts(input);
  const reports = (reportsRes.data ?? []) as ReportRow[];

  // 各レポートのコメントを取得（著者名解決・新しい順）。
  const reportIds = reports.map((r) => r.id);
  const commentsByReport = new Map<string, { id: string; body: string; authorName: string; createdAt: string; canDelete: boolean }[]>();
  if (reportIds.length) {
    const { data: cData } = await sb
      .from("pmo_report_comments")
      .select("id, report_id, body, created_at, created_by")
      .in("report_id", reportIds)
      .order("created_at", { ascending: false });
    const cRows = (cData ?? []) as { id: string; report_id: string; body: string; created_at: string; created_by: string | null }[];
    const authorIds = Array.from(new Set(cRows.map((c) => c.created_by).filter((x): x is string => !!x)));
    const nameOf = new Map<string, string>();
    if (authorIds.length) {
      const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", authorIds);
      for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
        nameOf.set(p.id, p.display_name ?? p.email ?? "—");
      }
    }
    const canModerate = ctx.role === "owner" || ctx.role === "admin";
    for (const c of cRows) {
      const list = commentsByReport.get(c.report_id) ?? [];
      list.push({
        id: c.id,
        body: c.body,
        authorName: c.created_by ? (nameOf.get(c.created_by) ?? "社内") : "社内",
        createdAt: c.created_at,
        canDelete: canModerate || c.created_by === ctx.userId,
      });
      commentsByReport.set(c.report_id, list);
    }
  }

  const reportsLite: PmoReportLite[] = reports.map((r) => ({
    id: r.id,
    mode: r.mode,
    title: r.title,
    report_md: r.report_md,
    model: r.model,
    created_at: r.created_at,
    trigger: r.digest?.trigger ?? null,
    comments: commentsByReport.get(r.id) ?? [],
  }));

  const openOpps = input.opps.filter((o) => o.status === "open" && isActiveYomi(o.yomi));
  const pipelineAmount = openOpps.reduce((s, o) => s + (o.amount ?? 0), 0);
  const thisMonth = input.months.find((m) => m.month === input.today.slice(0, 7));
  const highCount = alerts.filter((a) => a.severity === "high").length;
  const activeProjects = input.projects.filter((p) => p.status !== "closed");

  return (
    <div>
      <PageHeader
        title="AI-PMO（ベテランPMアドバイザー）"
        subtitle="鳥の目で俯瞰・虫の目で詳細・魚の目で流れ・コウモリの目でヌケモレ点検。振り返りと段取りを支えるスーパーアドバイザー"
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <StatCard label="進行中の案件パイプライン" amount={pipelineAmount} sub={`${openOpps.length}件`} />
        <StatCard
          label={`今月の受注実績${thisMonth && thisMonth.target > 0 ? " / 目標" : ""}`}
          amount={thisMonth?.actual ?? 0}
          accent
          sub={
            thisMonth && thisMonth.target > 0
              ? `目標 ${formatManYen(thisMonth.target).value}${formatManYen(thisMonth.target).unit} ・ ヨミ加重 ${formatManYen(thisMonth.weighted).value}${formatManYen(thisMonth.weighted).unit}`
              : "目標未設定"
          }
        />
        <StatCard label="ヌケモレアラート" raw={`${alerts.length}`} sub={highCount > 0 ? `うち重要 ${highCount}件` : "重要なし"} />
        <StatCard label="進行中デリバリーPJ" raw={`${activeProjects.length}`} sub={`全${input.projects.length}件`} />
      </div>

      <PmoWorkspace reports={reportsLite} alerts={alerts} hasApiKey={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </div>
  );
}
