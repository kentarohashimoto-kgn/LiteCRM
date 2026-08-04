import Link from "next/link";
import { ArrowRight, PenLine } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getYomiHistory } from "@/lib/data/yomi-history";
import { getMembersLite } from "@/lib/data/workspace";
import { fillYomiReasonAction } from "@/server/actions/yomi";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** ヨミ先頭コード→pill色(週報の行背景と揃える)。 */
const YOMI_PILL: Record<string, string> = {
  "0": "bg-emerald-100 text-emerald-700",
  "1": "bg-teal-light text-teal-deep",
  "2": "bg-teal-light/60 text-teal-deep",
  "3": "bg-sky-50 text-sky-700",
  "4": "bg-amber-50 text-amber-700",
  "5": "bg-amber-50/70 text-amber-700",
  "6": "bg-mist-soft text-ink/60",
  "7": "bg-rose-100 text-rose-600",
  "8": "bg-rose-50 text-rose-500",
  "9": "bg-violet-50 text-violet-600",
};

function YomiPill({ y }: { y: string | null }) {
  if (!y) return <span className="text-ink/30 text-xs">未設定</span>;
  return <span className={cn("pill text-[10px] font-bold whitespace-nowrap", YOMI_PILL[y.charAt(0)] ?? "bg-mist-soft text-ink/55")}>{y}</span>;
}

const fmtDT = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const DAYS_OPTIONS = [7, 28, 90];

/** ヨミ変更履歴: 全画面のヨミ変更を自動記録し、受注/オチ/定期追いの要因を振り返り記入する。 */
export default async function YomiHistoryPage(
  props: {
    searchParams: Promise<{ days?: string; owner?: string; missing?: string; saved?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const days = DAYS_OPTIONS.includes(Number(searchParams.days)) ? Number(searchParams.days) : 28;
  const owner = (searchParams.owner ?? "").trim();
  const onlyMissing = searchParams.missing === "1";

  const [allRows, members] = await Promise.all([getYomiHistory(days), getMembersLite()]);
  const rows = allRows
    .filter((r) => !owner || r.ownerUserId === owner)
    .filter((r) => !onlyMissing || (r.reasonRequired && !r.reason));

  const won = rows.filter((r) => r.toYomi === "0.受注").length;
  const dropped = rows.filter((r) => r.toYomi === "7.オチ" || r.toYomi === "6.定期追い").length;
  const missing = rows.filter((r) => r.reasonRequired && !r.reason).length;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { days: String(days), owner, missing: onlyMissing ? "1" : "", ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/app/reviews/yomi-history${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="ヨミ変更履歴"
        subtitle="どの画面からのヨミ変更も自動で記録されます。受注・オチ・定期追いへの変更は要因を記入してください（成約分析・失注分析の元データになります）。"
        action={
          <div className="flex items-center gap-1.5 text-xs">
            {DAYS_OPTIONS.map((d) => (
              <Link key={d} href={qs({ days: String(d) })} className={cn("btn-ghost px-2 py-1", d === days && "bg-teal-light/50 text-teal-deep font-bold")}>
                {d}日
              </Link>
            ))}
          </div>
        }
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{ reason: "要因を記録しました。受注/オチの要因は成約・失注分析にも反映されます。" }}
        errorMessages={{
          empty_reason: "要因が空です。一言で構わないので記入してください。",
          invalid: "入力内容が不正です。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">ヨミ変更（{days}日間）</div><div className="stat-value mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">受注へ</div><div className="stat-value mt-1 text-emerald-600">{won}</div></Card>
        <Card><div className="text-xs text-ink/50">オチ・定期追いへ</div><div className="stat-value mt-1 text-rose-600">{dropped}</div></Card>
        <Card>
          <div className="text-xs text-ink/50">要因未記入</div>
          <div className={cn("stat-value mt-1", missing > 0 && "text-accent-orange")}>{missing}</div>
        </Card>
      </div>

      <Section
        title={`履歴（${rows.length}件）`}
        action={
          <div className="flex items-center gap-2 text-xs">
            <form method="get" className="flex items-center gap-1.5">
              <input type="hidden" name="days" value={days} />
              {onlyMissing && <input type="hidden" name="missing" value="1" />}
              <select name="owner" defaultValue={owner} className="input text-xs py-1 w-auto" aria-label="担当">
                <option value="">担当: 全員</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                ))}
              </select>
              <button type="submit" className="btn-ghost text-xs py-1">表示</button>
            </form>
            <Link href={qs({ missing: onlyMissing ? "" : "1" })} className={cn("btn-ghost text-xs", onlyMissing && "bg-amber-50 text-accent-orange font-bold")}>
              要因未記入のみ
            </Link>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-ink/40 py-8 text-center">{onlyMissing ? "要因未記入の変更はありません。" : "この期間のヨミ変更はまだありません。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 960 }}>
              <thead className="text-ink/40 text-xs bg-mist-soft/30">
                <tr>
                  <th className="th">日時</th>
                  <th className="th">顧客 / 案件</th>
                  <th className="th">担当</th>
                  <th className="th">変更</th>
                  <th className="th">要因（受注・オチ・定期追いは必須）</th>
                  <th className="th">変更者</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {rows.map((r) => (
                  <tr key={r.id} className="row-hover align-top">
                    <td className="td whitespace-nowrap tabular-nums text-ink/60">{fmtDT(r.changedAt)}</td>
                    <td className="td">
                      <Link href={`/app/opportunities/${r.opportunityId}`} className="hover:text-teal-deep">
                        {r.accountName !== "—" && <span className="text-ink/50">{r.accountName}／</span>}{r.oppName}
                      </Link>
                    </td>
                    <td className="td text-xs text-ink/60 whitespace-nowrap">{r.ownerName}</td>
                    <td className="td whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <YomiPill y={r.fromYomi} /> <ArrowRight size={11} className="text-ink/30" /> <YomiPill y={r.toYomi} />
                      </span>
                    </td>
                    <td className="td">
                      {r.reason ? (
                        <span className="text-xs text-ink/75">{r.reason}</span>
                      ) : r.reasonRequired ? (
                        <form action={fillYomiReasonAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="log_id" value={r.id} />
                          <input type="hidden" name="back_days" value={days} />
                          {owner && <input type="hidden" name="back_owner" value={owner} />}
                          {onlyMissing && <input type="hidden" name="back_missing" value="1" />}
                          <input
                            name="reason"
                            required
                            maxLength={200}
                            placeholder={r.toYomi === "0.受注" ? "受注の要因(勝因)を記入…" : "オチ・定期追いの要因を記入…"}
                            className="input text-xs py-1 flex-1 min-w-[220px] border-accent-orange/50 bg-amber-50/40"
                          />
                          <SubmitButton className="btn-ghost text-xs py-1 inline-flex items-center gap-1 text-teal-deep whitespace-nowrap" pendingLabel="記録中…">
                            <PenLine size={12} /> 記録
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-ink/25 text-xs">—</span>
                      )}
                    </td>
                    <td className="td text-xs text-ink/50 whitespace-nowrap">{r.changedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink/40 mt-2">
          記入した要因は、受注→「成約要因(win_reason)」・オチ→「失注理由(lost_reason)」として案件にも反映され（手入力済みの場合は上書きしません）、失注/成約分析で集計されます。
        </p>
      </Section>
    </div>
  );
}
