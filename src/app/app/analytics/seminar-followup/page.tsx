import Link from "next/link";
import { listSeminars, getSeminarFollowup } from "@/lib/data/seminar-followup";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { FOLLOWUP_RANK_COLOR, ACTION_COLOR, ENG_RANK_COLOR, stageLabel } from "@/lib/seminar-followup";
import { formatDate, formatDateFull, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SeminarFollowupPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const sp = await searchParams;
  const seminars = await listSeminars();
  const selected = sp.s || seminars[0]?.name || "";
  const rows = selected ? await getSeminarFollowup(selected) : [];

  const counts = {
    S: rows.filter((r) => r.score.rank === "S").length,
    A: rows.filter((r) => r.score.rank === "A").length,
    deal: rows.filter((r) => r.open_count > 0).length,
    revive: rows.filter((r) => r.open_count === 0 && (r.lost_count > 0 || r.opp_count > 0)).length,
    known: rows.filter((r) => r.prior_sources > 0 || r.opp_count > 0).length,
  };

  return (
    <div>
      <PageHeader
        title="セミナー攻略リスト"
        subtitle="参加者を過去の流入元・商談・エンゲージメント・接点履歴と自動で突合し、フォロー優先度とアクションを提案します。セミナーを切り替えて何度でも使えます。"
      />

      {/* セミナー選択 */}
      <div className="flex flex-wrap gap-2 mb-5">
        {seminars.map((s) => (
          <Link
            key={s.name}
            href={`/app/analytics/seminar-followup?s=${encodeURIComponent(s.name)}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition",
              s.name === selected
                ? "border-teal-primary bg-teal-light/30 text-teal-deep font-semibold"
                : "border-black/10 bg-white text-ink/60 hover:border-teal-primary/40",
            )}
          >
            {s.name}
            <span className="ml-1.5 text-[11px] text-ink/40">{s.participants}名</span>
          </Link>
        ))}
        {seminars.length === 0 && <span className="text-sm text-ink/40">セミナー回答データがありません。</span>}
      </div>

      {selected && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <Card><div className="text-xs text-ink/50">参加者</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
            <Card><div className="text-xs text-ink/50">最優先(Sランク)</div><div className="text-2xl font-bold mt-1 text-rose-600">{counts.S}</div></Card>
            <Card><div className="text-xs text-ink/50">進行中商談あり</div><div className="text-2xl font-bold mt-1 text-rose-500">{counts.deal}</div></Card>
            <Card><div className="text-xs text-ink/50">掘り起こし対象</div><div className="text-2xl font-bold mt-1 text-orange-500">{counts.revive}</div></Card>
            <Card><div className="text-xs text-ink/50">既存接点あり</div><div className="text-2xl font-bold mt-1 stat-accent">{counts.known}</div></Card>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th text-center">優先</th>
                  <th className="th text-right">点</th>
                  <th className="th">参加者 / 会社</th>
                  <th className="th">推奨アクション</th>
                  <th className="th text-center">ｴﾝｹﾞｰｼﾞ</th>
                  <th className="th">過去の流入元</th>
                  <th className="th">過去商談</th>
                  <th className="th">温度・根拠</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {rows.map((r) => {
                  const isNew = r.prior_sources === 0 && r.opp_count === 0;
                  return (
                    <tr key={r.email} className={cn("row-hover align-top", r.score.rank === "S" && "bg-rose-50/40")}>
                      <td className="td text-center">
                        <span className={cn("pill text-[11px] font-bold", FOLLOWUP_RANK_COLOR[r.score.rank])}>{r.score.rank}</span>
                      </td>
                      <td className="td text-right tabular-nums font-semibold">{r.score.total}</td>
                      <td className="td max-w-[200px]">
                        <div className="font-medium">{r.name ?? "—"}</div>
                        <div className="text-xs text-ink/50">{r.company}</div>
                        <div className="text-[11px] text-ink/40">{[r.job_title, r.employee_size].filter(Boolean).join(" / ")}</div>
                        {r.lead && (
                          <Link href={`/app/leads/${r.lead.id}`} className="text-[11px] text-teal-primary hover:underline">リードを開く →</Link>
                        )}
                      </td>
                      <td className="td max-w-[180px]">
                        <span className={cn("pill text-[11px] font-semibold", ACTION_COLOR[r.score.actionKey])}>{r.score.action}</span>
                      </td>
                      <td className="td text-center">
                        {r.engagement.rank ? (
                          <span className={cn("pill text-[11px] font-bold", ENG_RANK_COLOR[r.engagement.rank] ?? "bg-mist-soft")}>
                            {r.engagement.rank}
                            <span className="ml-1 font-normal text-[10px] opacity-70">{r.engagement.score}</span>
                          </span>
                        ) : <span className="text-ink/30 text-xs">—</span>}
                      </td>
                      <td className="td max-w-[170px] text-xs">
                        {r.lead?.raw_event && r.lead.raw_event !== selected ? (
                          <div>
                            <span className="font-medium text-ink/70">{r.lead.raw_event}</span>
                            <span className="block text-ink/40">{r.lead.source} / {formatDate(r.lead.acquired_at)}獲得</span>
                          </div>
                        ) : isNew ? (
                          <span className="pill bg-emerald-100 text-emerald-700 text-[10px]">新規(初接点)</span>
                        ) : (
                          <span className="text-ink/40">本セミナー経由</span>
                        )}
                        {r.prior_sources >= 2 && (
                          <span className="block text-[10px] text-teal-deep mt-0.5">複数接点 {r.prior_sources}媒体</span>
                        )}
                      </td>
                      <td className="td max-w-[230px] text-xs">
                        {r.opps.length === 0 ? (
                          <span className="text-ink/30">—</span>
                        ) : (
                          <div className="space-y-1">
                            {r.opps.slice(0, 2).map((o, i) => (
                              <div key={i} className="border-l-2 border-black/10 pl-2">
                                <span className={cn("font-medium", o.status === "open" ? "text-rose-600" : o.status === "lost" ? "text-ink/50" : "text-teal-deep")}>
                                  {stageLabel(o.stage)}
                                </span>
                                {o.first_meeting_date && <span className="text-ink/40 ml-1">{formatDate(o.first_meeting_date)}</span>}
                                {o.notes && <div className="text-[11px] text-ink/45 line-clamp-2">{o.notes}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="td max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {r.score.reasons.map((x) => (
                            <span key={x} className="pill bg-mist-soft text-ink/55 text-[10px]">{x}</span>
                          ))}
                        </div>
                        {r.memo && r.memo !== "受講" && r.memo !== "申込のみ" && (
                          <div className="text-[11px] text-ink/45 mt-1">📝 {r.memo}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="td"><EmptyState message="参加者データがありません。" /></td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink/40 mt-3">
            ※ 優先度スコア＝過去商談(進行中/失注/実績)＋アポ獲得＋エンゲージメント＋複数接点＋役職＋規模＋温度。
            ランク S≥60 / A≥40 / B≥22 / C。推奨アクションは履歴の状況から自動分類しています。
          </p>
          <p className="text-xs text-ink/40">
            「過去にどの展示会/施策で接点を持ったか」「過去に商談したか・その時のメモ」を1画面で確認し、当日中に優先架電すべき相手を判断できます。
          </p>
        </>
      )}
    </div>
  );
}
