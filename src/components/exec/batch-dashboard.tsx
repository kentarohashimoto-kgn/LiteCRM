import { Section, StatCard, EmptyState } from "@/components/ui/primitives";
import { formatDate, formatTimeJst } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { BatchDashboard } from "@/lib/data/batch-runs";

/** job_kind の表示名。 */
const KIND_LABEL: Record<string, string> = {
  meeting_summary: "議事録要約",
  na_task_draft: "NAタスク下書き",
  followup_draft: "フォロー下書き",
  briefing: "事前ブリーフ",
  weekly_report: "週報",
  weekly_usage_review: "週次使用実績",
  knowledge_extract: "ノウハウ抽出",
  heartbeat: "疎通確認",
};

const STATUS_CLS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-50 text-accent-orange border border-accent-orange/20",
  error: "bg-rose-100 text-rose-600",
  running: "bg-teal-light text-teal-deep",
};

const STATUS_LABEL: Record<string, string> = {
  success: "成功",
  partial: "一部",
  error: "失敗",
  running: "実行中",
};

function KindPill({ kind }: { kind: string }) {
  return <span className="pill bg-mist-soft text-ink/70 border border-black/5">{KIND_LABEL[kind] ?? kind}</span>;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("pill", STATUS_CLS[status] ?? "bg-mist-soft text-ink/60")}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function BatchDashboardView({ data }: { data: BatchDashboard }) {
  const { runs, weekly } = data;

  return (
    <div className="space-y-6">
      {/* サマリ指標 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="今週の生成件数" raw={`${data.thisWeekGenerated}`} sub="件（AIが作った下書き）" />
        <StatCard
          label="今週の枠到達"
          raw={`${data.thisWeekLimitHits}`}
          accent={data.thisWeekLimitHits > 0}
          sub="回（利用枠に到達した実行）"
        />
        <StatCard label="直近9週の総生成" raw={`${data.total8wGenerated}`} sub="件" />
        <StatCard
          label="夜間割合"
          raw={data.nightlyShare == null ? "—" : `${data.nightlyShare}%`}
          sub="夜間トリガの割合"
        />
      </div>

      {/* 週次サマリ */}
      <Section title="週次サマリ（直近9週）">
        {weekly.length === 0 ? (
          <EmptyState message="まだバッチ実行の記録がありません。夜間バッチ(03:00 JST)が走ると、ここに週次の処理量が並びます。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th className="th">週（月曜〜）</th>
                  <th className="th text-right">実行回数</th>
                  <th className="th text-right">生成</th>
                  <th className="th text-right">失敗</th>
                  <th className="th text-right">繰り越し</th>
                  <th className="th text-right">枠到達</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => (
                  <tr key={w.weekStart} className="row-hover border-t border-black/[0.04]">
                    <td className="td">{formatDate(w.weekStart)}</td>
                    <td className="td text-right">{w.runs}</td>
                    <td className="td text-right font-semibold text-teal-deep">{w.generated}</td>
                    <td className="td text-right">{w.failed > 0 ? <span className="text-rose-600">{w.failed}</span> : "—"}</td>
                    <td className="td text-right">{w.deferred > 0 ? w.deferred : "—"}</td>
                    <td className="td text-right">
                      {w.limitHitRuns > 0 ? (
                        <span className="pill bg-amber-50 text-accent-orange border border-accent-orange/20">{w.limitHitRuns}回</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 実行ログ */}
      <Section title="実行ログ（最近の実行）">
        {runs.length === 0 ? (
          <EmptyState message="実行ログはまだありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th className="th">実行日時</th>
                  <th className="th">ジョブ</th>
                  <th className="th">状態</th>
                  <th className="th text-right">対象</th>
                  <th className="th text-right">生成</th>
                  <th className="th">枠</th>
                  <th className="th">メモ</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 40).map((r) => (
                  <tr key={r.id} className="row-hover border-t border-black/[0.04] align-top">
                    <td className="td whitespace-nowrap">{formatTimeJst(r.started_at)}</td>
                    <td className="td"><KindPill kind={r.job_kind} /></td>
                    <td className="td"><StatusPill status={r.status} /></td>
                    <td className="td text-right">{r.targets_total}</td>
                    <td className="td text-right font-semibold text-teal-deep">{r.items_generated}</td>
                    <td className="td">
                      {r.limit_hit ? (
                        <span className="pill bg-amber-50 text-accent-orange border border-accent-orange/20">到達</span>
                      ) : (
                        <span className="text-ink/30">—</span>
                      )}
                    </td>
                    <td className="td whitespace-normal max-w-[280px] text-ink/60">{r.usage_note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
