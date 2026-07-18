import Link from "next/link";
import { AlertTriangle, Bird, Bug, Fish, History, Moon, Sparkles } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, StatCard, EmptyState } from "@/components/ui/primitives";
import { cn, formatDateFull, formatManYen } from "@/lib/utils";
import { gatherPmoInput } from "@/lib/data/pmo";
import { PMO_MODE_MAP, detectPmoAlerts, isActiveYomi, type PmoAlert } from "@/lib/pmo";
import { PmoReportGenerator } from "@/components/pmo/report-generator";
import { DeleteReportButton } from "@/components/pmo/delete-report-button";
import { MarkdownLite } from "@/components/pmo/markdown-lite";

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

/** 生成種別バッジ(夜間バッチ / 手動)。 */
function triggerBadge(digest: ReportRow["digest"]) {
  const nightly = digest?.trigger === "nightly";
  return (
    <span className={cn("pill shrink-0", nightly ? "bg-indigo-50 text-indigo-600" : "bg-teal-light text-teal-deep")}>
      {nightly ? "夜間バッチ" : "手動生成"}
    </span>
  );
}

const SEVERITY_STYLE: Record<PmoAlert["severity"], { label: string; cls: string }> = {
  high: { label: "重要", cls: "bg-rose-50 text-rose-600" },
  mid: { label: "注意", cls: "bg-amber-50 text-amber-700" },
  low: { label: "軽微", cls: "bg-black/[0.04] text-ink/50" },
};

/**
 * AI-PMO: ベテランPMスーパーアドバイザー。
 * 鳥の目(俯瞰)・虫の目(詳細)・魚の目(トレンド)・コウモリの目(逆視点)で
 * 振り返りPDCA / 未来の段取り / 案件・PJ管理 / 経営俯瞰を支援する。
 */
export default async function PmoPage({ searchParams }: { searchParams: { report?: string } }) {
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
  const selected = (searchParams.report && reports.find((r) => r.id === searchParams.report)) || reports[0] || null;

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

      <div className="space-y-5">
        <Section title="ベテランPMに相談する" icon={<Sparkles size={16} className="text-teal-deep" />}>
          <div className="flex items-center gap-3 text-xs text-ink/45 mb-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Bird size={13} /> 鳥の目=俯瞰</span>
            <span className="inline-flex items-center gap-1"><Bug size={13} /> 虫の目=詳細</span>
            <span className="inline-flex items-center gap-1"><Fish size={13} /> 魚の目=トレンド</span>
            <span className="inline-flex items-center gap-1"><Moon size={13} /> コウモリの目=逆視点でヌケモレ点検</span>
          </div>
          <PmoReportGenerator hasApiKey={Boolean(process.env.ANTHROPIC_API_KEY)} />
        </Section>

        <Section
          title={`ヌケモレアラート（自動検知・${alerts.length}件）`}
          icon={<AlertTriangle size={16} className="text-amber-500" />}
        >
          {alerts.length === 0 ? (
            <EmptyState message="ヌケモレは検知されていません。この調子です。" />
          ) : (
            <ul className="divide-y divide-black/[0.04]">
              {alerts.slice(0, 40).map((a) => (
                <li key={a.key} className="py-2 flex items-start gap-2">
                  <span className={cn("pill shrink-0 mt-0.5 font-semibold", SEVERITY_STYLE[a.severity].cls)}>
                    {SEVERITY_STYLE[a.severity].label}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-ink">
                      <span className="text-xs text-ink/40 mr-1.5">[{a.category}]</span>
                      {a.href ? (
                        <Link href={a.href} className="font-semibold hover:text-teal-deep">
                          {a.title}
                        </Link>
                      ) : (
                        <span className="font-semibold">{a.title}</span>
                      )}
                    </div>
                    <div className="text-xs text-ink/50 mt-0.5">{a.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {alerts.length > 40 && <p className="text-xs text-ink/40 mt-2">他 {alerts.length - 40} 件。AIレポート生成で全件を精査できます。</p>}
        </Section>

        <Section
          title={`実行済みレポート一覧（${reports.length}件）`}
          icon={<History size={16} className="text-ink/40" />}
          action={<span className="text-[11px] text-ink/35">行を選ぶと下に詳細が表示されます</span>}
        >
          {reports.length === 0 ? (
            <EmptyState message="まだレポートがありません。上のモードを選んで最初のレポートを生成するか、夜間バッチの生成をお待ちください。" />
          ) : (
            <ul className="divide-y divide-black/[0.04]">
              {reports.map((r) => {
                const active = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/app/pmo?report=${r.id}`}
                      className={cn(
                        "flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg transition-colors",
                        active ? "bg-teal-light/50" : "hover:bg-black/[0.02]",
                      )}
                    >
                      <span className="text-lg shrink-0">{PMO_MODE_MAP[r.mode]?.emoji ?? "📋"}</span>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm truncate", active ? "font-semibold text-teal-deep" : "text-ink/85")}>
                          {PMO_MODE_MAP[r.mode]?.label ?? r.mode}
                        </div>
                        <div className="text-[11px] text-ink/40 mt-0.5">{formatDateFull(r.created_at)}</div>
                      </div>
                      {triggerBadge(r.digest)}
                      {active && <span className="pill bg-teal-deep text-white shrink-0">表示中</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {selected ? (
          <Section
            title={`${PMO_MODE_MAP[selected.mode]?.label ?? "レポート"} 詳細`}
            icon={<span>{PMO_MODE_MAP[selected.mode]?.emoji ?? "📋"}</span>}
            action={
              <div className="flex items-center gap-3">
                {triggerBadge(selected.digest)}
                <span className="text-[11px] text-ink/35">
                  生成: {formatDateFull(selected.created_at)}
                  {selected.model ? ` ・ ${selected.model}` : ""}
                </span>
                <DeleteReportButton reportId={selected.id} />
              </div>
            }
          >
            <MarkdownLite text={selected.report_md} />
          </Section>
        ) : (
          <Section title="AI-PMOレポート 詳細" icon={<Sparkles size={16} className="text-teal-deep" />}>
            <EmptyState message="一覧からレポートを選ぶと、ここに詳細が表示されます。" />
          </Section>
        )}
      </div>
    </div>
  );
}
