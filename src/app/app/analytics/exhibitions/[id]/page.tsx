import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Users, Target, CircleAlert } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getExhibitionDrill } from "@/lib/data/exhibition-drill";
import { exhibitionLabel } from "@/lib/exhibition-label";
import { STAGE_MAP } from "@/lib/constants";
import { formatYen, formatDateFull, cn } from "@/lib/utils";
import { RowComments } from "@/components/analytics/exhibition-comments";

export const dynamic = "force-dynamic";

const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");

export default async function ExhibitionDrillPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx();
  const d = await getExhibitionDrill(params.id);
  if (!d.campaign) notFound();

  const label = exhibitionLabel({ name: d.campaign.name, event_date: d.campaign.event_date });
  const open = d.opps.filter((o) => o.status === "open");
  const won = d.opps.filter((o) => o.status === "won");
  const lost = d.opps.filter((o) => o.status === "lost");
  const wonAmount = won.reduce((s, o) => s + (o.amount ?? 0), 0);
  const weighted = open.reduce((s, o) => s + Math.round((o.amount * o.probability) / 100), 0);

  // ヨミ内訳（進行中）— 売上が伸びない理由の可視化
  const yomiCount = new Map<string, number>();
  for (const o of open) yomiCount.set(o.yomi ?? "未設定", (yomiCount.get(o.yomi ?? "未設定") ?? 0) + 1);
  const yomiRows = [...yomiCount.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/app/analytics/exhibitions" className="text-ink/40 hover:text-teal-deep">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-ink leading-tight">{label}</h1>
          <p className="text-[11px] text-ink/45">
            {d.campaign.organizer ?? "—"}
            {d.campaign.event_date && <span className="ml-2">開催 {formatDateFull(d.campaign.event_date)}</span>}
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="商談（案件）" value={String(d.opps.length)} sub={`進行中 ${open.length} / 受注 ${won.length} / 失注 ${lost.length}`} />
        <Kpi label="受注額" value={wonAmount ? yen(wonAmount) : "¥0"} accent />
        <Kpi label="進行中Weighted" value={yen(weighted)} />
        <Kpi label="進行中パイプ" value={yen(open.reduce((s, o) => s + (o.amount ?? 0), 0))} />
        <Kpi label="未商談の重要リード" value={String(d.totalUntouched)} sub="要アプローチ" alert={d.totalUntouched > 0} />
      </div>

      {/* 売上が伸びていない理由 */}
      {won.length === 0 && open.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>受注はまだ0件です。</b> 進行中の商談が {open.length} 件あり、受注手前の状態です。下のヨミ内訳と担当の次アクションを確認してください。
        </div>
      )}

      {/* ヨミ内訳 */}
      {yomiRows.length > 0 && (
        <div className="card card-pad">
          <div className="section-title mb-2"><Target size={15} /> 進行中のヨミ内訳</div>
          <div className="flex flex-wrap gap-2">
            {yomiRows.map(([y, n]) => (
              <span key={y} className="pill bg-mist-soft text-ink/70">
                {y} <b className="ml-1 tabular-nums">{n}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 案件・商談一覧 */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04] flex items-center gap-2">
          <h2 className="section-title"><Users size={15} /> 案件・商談一覧</h2>
          <span className="pill bg-mist-soft text-ink/50">{d.opps.length}</span>
        </div>
        {d.opps.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink/40 text-center">この展示会に紐づく案件はまだありません。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th">顧客 / 案件</th>
                <th className="th">担当</th>
                <th className="th">ステージ</th>
                <th className="th">ヨミ</th>
                <th className="th text-right">金額</th>
                <th className="th">次アクション</th>
                <th className="th">コメント</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {d.opps.map((o) => (
                <tr key={o.id} className={cn("align-top row-hover", o.status === "won" && "bg-teal-light/20", o.status === "lost" && "opacity-55")}>
                  <td className="td max-w-[240px]">
                    <div className="font-medium text-ink truncate" title={o.name}>{o.name}</div>
                    <div className="text-[11px] text-ink/45 truncate">{o.account_name ?? "—"}</div>
                  </td>
                  <td className="td text-ink/70 whitespace-nowrap">{o.owner_name ?? "—"}</td>
                  <td className="td whitespace-nowrap">
                    <span className={cn("pill text-[10px]", o.status === "won" ? "bg-teal-light text-teal-deep" : o.status === "lost" ? "bg-rose-50 text-rose-500" : "bg-mist-soft text-ink/60")}>
                      {STAGE_MAP[o.stage]?.label ?? o.stage}
                    </span>
                  </td>
                  <td className="td whitespace-nowrap text-ink/70">{o.yomi ?? "—"}</td>
                  <td className="td text-right tabular-nums whitespace-nowrap">{o.amount ? formatYen(o.amount) : "—"}</td>
                  <td className="td text-[12px] text-ink/60 max-w-[180px]">
                    {o.next_action_text ? (
                      <span className="line-clamp-2">{o.next_action_date ? `${formatDateFull(o.next_action_date)}: ` : ""}{o.next_action_text}</span>
                    ) : (
                      <span className="text-rose-400/80 text-[11px]">未設定</span>
                    )}
                  </td>
                  <td className="td">
                    <RowComments kind="opp" entityId={o.id} comments={d.oppComments[o.id] ?? []} currentUserId={ctx.userId} />
                  </td>
                  <td className="td">
                    <Link href={`/app/opportunities/${o.id}`} className="text-ink/30 hover:text-teal-deep" title="案件を開く"><ExternalLink size={14} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 未商談の重要リスト */}
      <div className="card overflow-x-auto">
        <div className="px-5 pt-4 pb-3 border-b border-black/[0.04] flex items-center gap-2">
          <h2 className="section-title"><CircleAlert size={15} /> 未商談の重要リスト</h2>
          <span className="pill bg-rose-50 text-rose-500">{d.totalUntouched}</span>
          <span className="text-[11px] text-ink/40 ml-1">ランク・役職から重要度を判定。上位 {d.leads.length} 件を表示</span>
        </div>
        {d.leads.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink/40 text-center">未商談の重要リードはありません（すべて商談化 or 対象外）。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-ink/40 text-xs bg-mist-soft/30">
              <tr>
                <th className="th">会社 / 担当者</th>
                <th className="th">役職</th>
                <th className="th">ランク</th>
                <th className="th">状況</th>
                <th className="th">営業担当</th>
                <th className="th">コメント</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04]">
              {d.leads.map((l) => (
                <tr key={l.id} className="align-top row-hover">
                  <td className="td max-w-[220px]">
                    <div className="font-medium text-ink truncate" title={l.company_name ?? ""}>{l.company_name ?? "—"}</div>
                    <div className="text-[11px] text-ink/45 truncate">{l.contact_name ?? "—"}</div>
                  </td>
                  <td className="td text-[12px] text-ink/60 max-w-[160px] truncate" title={l.job_title ?? ""}>{l.job_title ?? "—"}</td>
                  <td className="td">
                    {l.rank ? <span className={cn("pill text-[10px]", l.rank === "S" ? "bg-rose-100 text-rose-600" : l.rank === "A" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/60")}>{l.rank}</span> : <span className="text-ink/30">—</span>}
                  </td>
                  <td className="td whitespace-nowrap text-[11px]">
                    <span className="pill bg-mist-soft text-ink/55">{l.nurture_status || l.funnel_stage || l.disposition || "未対応"}</span>
                  </td>
                  <td className="td text-ink/70 whitespace-nowrap">{l.owner_name ?? "—"}</td>
                  <td className="td">
                    <RowComments kind="lead" entityId={l.id} comments={d.leadComments[l.id] ?? []} currentUserId={ctx.userId} />
                  </td>
                  <td className="td">
                    <Link href={`/app/leads/${l.id}`} className="text-ink/30 hover:text-teal-deep" title="リードを開く"><ExternalLink size={14} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, alert }: { label: string; value: string; sub?: string; accent?: boolean; alert?: boolean }) {
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold text-ink/50">{label}</div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums", accent ? "stat-accent" : alert ? "text-rose-500" : "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink/45">{sub}</div>}
    </div>
  );
}
