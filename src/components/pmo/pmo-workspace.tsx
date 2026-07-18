"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bird, Bug, ChevronRight, FileText, Fish, MessageSquare, Moon, Sparkles } from "lucide-react";
import { cn, formatDateFull } from "@/lib/utils";
import { PMO_MODE_MAP } from "@/lib/pmo";
import { MarkdownLite } from "@/components/pmo/markdown-lite";
import { PmoReportGenerator } from "@/components/pmo/report-generator";
import { DeleteReportButton } from "@/components/pmo/delete-report-button";
import { PmoReportComments, type PmoCommentLite } from "@/components/pmo/report-comments";

export type PmoReportLite = {
  id: string;
  mode: string;
  title: string;
  report_md: string;
  model: string | null;
  created_at: string;
  trigger: string | null;
  comments: PmoCommentLite[];
};

export type PmoAlertLite = {
  key: string;
  severity: "high" | "mid" | "low";
  category: string;
  title: string;
  detail: string;
  href?: string;
};

type Tab = "reports" | "alerts" | "new";

const SEVERITY_STYLE: Record<PmoAlertLite["severity"], { label: string; cls: string }> = {
  high: { label: "重要", cls: "bg-rose-50 text-rose-600" },
  mid: { label: "注意", cls: "bg-amber-50 text-amber-700" },
  low: { label: "軽微", cls: "bg-black/[0.04] text-ink/50" },
};

function TriggerBadge({ trigger }: { trigger: string | null }) {
  const nightly = trigger === "nightly";
  return (
    <span className={cn("pill shrink-0", nightly ? "bg-indigo-50 text-indigo-600" : "bg-teal-light text-teal-deep")}>
      {nightly ? "夜間バッチ" : "手動生成"}
    </span>
  );
}

/**
 * AI-PMO 作業画面。タブ(レポート/アラート/新規生成)で縦の長さを抑え、
 * レポートは左=一覧・右=詳細の2ペインで、選択をクライアント側で即時切替する
 * (ページ遷移しないのでトップへスクロールしない)。各ペインは内部スクロール。
 */
export function PmoWorkspace({
  reports,
  alerts,
  hasApiKey,
}: {
  reports: PmoReportLite[];
  alerts: PmoAlertLite[];
  hasApiKey: boolean;
}) {
  const [tab, setTab] = useState<Tab>(reports.length ? "reports" : "new");
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // 生成/削除でreportsが変わった時の選択整合。
  useEffect(() => {
    if (pendingId && reports.some((r) => r.id === pendingId)) {
      setSelectedId(pendingId);
      setPendingId(null);
      return;
    }
    if (!reports.some((r) => r.id === selectedId)) {
      setSelectedId(reports[0]?.id ?? null);
    }
  }, [reports, pendingId, selectedId]);

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? reports[0] ?? null,
    [reports, selectedId],
  );

  const sevCounts = useMemo(
    () => ({
      high: alerts.filter((a) => a.severity === "high").length,
      mid: alerts.filter((a) => a.severity === "mid").length,
      low: alerts.filter((a) => a.severity === "low").length,
    }),
    [alerts],
  );

  const TabButton = ({ id, icon, label, count }: { id: Tab; icon: React.ReactNode; label: string; count?: number }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors",
        tab === id ? "bg-teal-deep text-white shadow-sm" : "text-ink/60 hover:bg-black/[0.04]",
      )}
    >
      {icon}
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-0.5 text-[11px] rounded-full px-1.5 py-0.5 leading-none",
            tab === id ? "bg-white/25 text-white" : "bg-black/[0.06] text-ink/55",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <TabButton id="reports" icon={<FileText size={15} />} label="レポート" count={reports.length} />
        <TabButton id="alerts" icon={<AlertTriangle size={15} />} label="ヌケモレ" count={alerts.length} />
        <TabButton id="new" icon={<Sparkles size={15} />} label="新規生成" />
      </div>

      {tab === "reports" &&
        (reports.length === 0 ? (
          <div className="card card-pad">
            <div className="text-center py-10 text-sm text-ink/45">
              まだレポートがありません。
              <button type="button" onClick={() => setTab("new")} className="text-teal-deep font-semibold ml-1 hover:underline">
                新規生成
              </button>
              から作成するか、夜間バッチの生成をお待ちください。
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
            {/* 左: 一覧(内部スクロール) */}
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-black/[0.05] text-xs font-semibold text-ink/50">
                実行済みレポート
              </div>
              <ul className="max-h-[30vh] lg:max-h-[68vh] overflow-y-auto p-2 space-y-1">
                {reports.map((r) => {
                  const active = selected?.id === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          "w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors",
                          active ? "bg-teal-light/60 ring-1 ring-teal-primary/30" : "hover:bg-black/[0.03]",
                        )}
                      >
                        <span className="text-lg shrink-0">{PMO_MODE_MAP[r.mode]?.emoji ?? "📋"}</span>
                        <div className="min-w-0 flex-1">
                          <div className={cn("text-sm truncate", active ? "font-semibold text-teal-deep" : "text-ink/85")}>
                            {PMO_MODE_MAP[r.mode]?.label ?? r.mode}
                          </div>
                          <div className="text-[11px] text-ink/40 mt-0.5 flex items-center gap-1.5">
                            <span>{formatDateFull(r.created_at)}</span>
                            {r.comments.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-teal-deep">
                                <MessageSquare size={11} />
                                {r.comments.length}
                              </span>
                            )}
                          </div>
                        </div>
                        {r.trigger === "nightly" && <span className="pill bg-indigo-50 text-indigo-600 shrink-0 text-[10px]">夜間</span>}
                        <ChevronRight size={15} className={cn("shrink-0", active ? "text-teal-deep" : "text-ink/20")} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* 右: 詳細(内部スクロール) */}
            <div className="card overflow-hidden">
              {selected ? (
                <>
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-black/[0.05]">
                    <h2 className="section-title">
                      <span>{PMO_MODE_MAP[selected.mode]?.emoji ?? "📋"}</span>
                      {PMO_MODE_MAP[selected.mode]?.label ?? "レポート"}
                    </h2>
                    <div className="flex items-center gap-3">
                      <TriggerBadge trigger={selected.trigger} />
                      <span className="text-[11px] text-ink/35 hidden sm:inline">
                        {formatDateFull(selected.created_at)}
                        {selected.model ? ` ・ ${selected.model}` : ""}
                      </span>
                      <DeleteReportButton reportId={selected.id} onDeleted={() => setSelectedId(null)} />
                    </div>
                  </div>
                  <div className="p-5 max-h-[55vh] lg:max-h-[68vh] overflow-y-auto">
                    <MarkdownLite text={selected.report_md} />
                    <PmoReportComments reportId={selected.id} comments={selected.comments} />
                  </div>
                </>
              ) : (
                <div className="p-5 text-center py-16 text-sm text-ink/45">左の一覧からレポートを選んでください。</div>
              )}
            </div>
          </div>
        ))}

      {tab === "alerts" && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-black/[0.05]">
            <h2 className="section-title">
              <AlertTriangle size={16} className="text-amber-500" />
              ヌケモレアラート（自動検知）
            </h2>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="pill bg-rose-50 text-rose-600">重要 {sevCounts.high}</span>
              <span className="pill bg-amber-50 text-amber-700">注意 {sevCounts.mid}</span>
              <span className="pill bg-black/[0.04] text-ink/50">軽微 {sevCounts.low}</span>
            </div>
          </div>
          {alerts.length === 0 ? (
            <div className="p-5 text-center py-12 text-sm text-ink/45">ヌケモレは検知されていません。この調子です。</div>
          ) : (
            <ul className="max-h-[68vh] overflow-y-auto divide-y divide-black/[0.04] px-5">
              {alerts.map((a) => (
                <li key={a.key} className="py-2.5 flex items-start gap-2">
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
        </div>
      )}

      {tab === "new" && (
        <div className="card card-pad">
          <div className="flex items-center gap-3 text-xs text-ink/45 mb-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Bird size={13} /> 鳥の目=俯瞰</span>
            <span className="inline-flex items-center gap-1"><Bug size={13} /> 虫の目=詳細</span>
            <span className="inline-flex items-center gap-1"><Fish size={13} /> 魚の目=トレンド</span>
            <span className="inline-flex items-center gap-1"><Moon size={13} /> コウモリの目=逆視点でヌケモレ点検</span>
          </div>
          <PmoReportGenerator
            hasApiKey={hasApiKey}
            onGenerated={(id) => {
              setPendingId(id);
              setTab("reports");
            }}
          />
        </div>
      )}
    </div>
  );
}
