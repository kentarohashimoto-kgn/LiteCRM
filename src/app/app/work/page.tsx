import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, FileUp } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getMyWorkContext, getMyWorkWeek, type WorkWeekStatus, type WorkEntry, type WorkWeek } from "@/lib/data/work-log";
import { todayJST, weekStartOf, addDaysISO, monthEndOf, formatHoursHM, GENERAL_UNIT } from "@/lib/work-time";
import { importWorkCsvAction } from "@/server/actions/work-log";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { WorkWeekEditor, type WorkUnit } from "@/components/work/work-week-editor";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<WorkWeekStatus, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-mist-soft text-ink/55" },
  submitted: { label: "提出済み（承認待ち）", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "承認済み", cls: "bg-emerald-50 text-emerald-700" },
  returned: { label: "差戻し（修正して再提出）", cls: "bg-rose-50 text-rose-600" },
};

const fmtMD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`;
};

/** 担当者の稼働実績 記入ページ(週次)。1つの表で行ごとに案件(担当者マスター)を選ぶ。 */
export default async function WorkPage(
  props: {
    searchParams: Promise<{ week?: string; saved?: string; error?: string; n?: string; lk?: string; um?: string; iv?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireCtx();
  const today = todayJST();
  const week = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "") ? weekStartOf(searchParams.week!) : weekStartOf(today);
  const weekEnd = addDaysISO(week, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(week, i));

  const { assignments, talent } = await getMyWorkContext();
  const ids = assignments.map((a) => a.assignment_id);
  const generalRequired = !!talent?.work_report_required;
  const monthKeyStr = week.slice(0, 7); // 表示週の月曜が属する月
  const monthStart = `${monthKeyStr}-01`;
  const monthEnd = monthEndOf(monthStart);
  const { entries, weeks, monthHours, generalMonthHours } = await getMyWorkWeek(
    ids, generalRequired ? talent!.talent_id : null, week, monthStart, monthEnd,
  );

  // 記入単位 = 紐づき案件(担当者ごとのマスター) + 全般稼働
  const allUnits: WorkUnit[] = [
    ...assignments.map((a) => ({ key: a.assignment_id, label: `${a.account_name ? a.account_name + "｜" : ""}${a.opp_name}` })),
    ...(generalRequired ? [{ key: GENERAL_UNIT, label: "全般稼働（案件なし）" }] : []),
  ];
  const unitKeyOf = (x: { assignment_id: string | null }) => x.assignment_id ?? GENERAL_UNIT;
  const weekByUnit = new Map<string, WorkWeek>(weeks.map((w) => [unitKeyOf(w), w]));
  const isLocked = (k: string) => {
    const st = weekByUnit.get(k)?.status;
    return st === "submitted" || st === "approved";
  };
  const editableUnits = allUnits.filter((u) => !isLocked(u.key));
  const lockedUnits = allUnits.filter((u) => isLocked(u.key));
  const editableEntries = entries.filter((e) => !isLocked(unitKeyOf(e)));
  const unitLabel = new Map(allUnits.map((u) => [u.key, u.label]));

  // 当月の経過割合(按分ペースの計算用)。過去月=1、未来月=0。
  const elapsedRatio =
    today >= monthEnd ? 1 : today < monthStart ? 0 : Number(today.slice(8, 10)) / Number(monthEnd.slice(8, 10));

  const imported = searchParams.saved === "import";

  return (
    <div>
      <PageHeader
        title="稼働報告"
        subtitle="担当している案件の稼働実績を日次で記入し、週ごとに提出してください。行ごとの「案件」で原価の紐づけ先を選べます（承認された実績が原価管理・月次請求の元データになります）。"
        action={
          <div className="flex items-center gap-1.5 text-sm">
            <Link href={`/app/work?week=${addDaysISO(week, -7)}`} className="btn-ghost px-2 py-1" aria-label="前の週"><ChevronLeft size={15} /></Link>
            <span className="font-semibold text-ink/80 tabular-nums">{week.slice(0, 4)}年 {fmtMD(week)}〜{fmtMD(weekEnd)} の週</span>
            <Link href={`/app/work?week=${addDaysISO(week, 7)}`} className="btn-ghost px-2 py-1" aria-label="次の週"><ChevronRight size={15} /></Link>
            <Link href="/app/work" className="btn-ghost text-xs">今週へ</Link>
          </div>
        }
      />

      {imported ? (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
          CSVから <b>{searchParams.n ?? 0}行</b> を取り込みました（下書きに追記）。
          {Number(searchParams.lk ?? 0) > 0 && <span className="ml-2 text-amber-700">提出済み・承認済みの週のため {searchParams.lk}行 をスキップしました。</span>}
          {Number(searchParams.um ?? 0) > 0 && <span className="ml-2">案件名が紐づき案件と一致しなかった {searchParams.um}行 は全般稼働に入れました（タスク欄に元の案件名を保全）。</span>}
          {Number(searchParams.iv ?? 0) > 0 && <span className="ml-2 text-rose-700">日付等が不正な {searchParams.iv}行 は無視しました。</span>}
          <span className="ml-2">内容を確認して「この週を提出」してください。</span>
        </div>
      ) : (
        <ActionNotice
          saved={searchParams.saved}
          error={searchParams.error}
          savedMessages={{
            work: "下書きを保存しました。週の記入が終わったら「この週を提出」を押してください。",
            submit: "提出しました。承認されるまで編集はロックされます。",
          }}
          errorMessages={{
            locked: "提出済み・承認済みの案件に行を追加することはできません。修正が必要な場合は管理者に差戻しを依頼してください。",
            empty: "記入行がありません。先に実績を記入して「下書き保存」してください。",
            invalid: "入力内容が不正です。",
            load_failed: "データの読み込みに失敗しました。再度お試しください。",
            save_failed: "保存に失敗しました。再度お試しください。",
            no_file: "CSVファイルを選択してください。",
            too_large: "ファイルが大きすぎます（2MBまで）。",
            format: "CSVの形式を認識できませんでした。「日付」「稼働時間」列を含むヘッダー行が必要です。",
            no_rows: "取り込める行が見つかりませんでした。",
            no_target: "記入対象がありません。稼働報告必須の設定または案件アサインをご確認ください。",
          }}
        />
      )}

      {allUnits.length === 0 ? (
        <Section title="">
          <div className="py-12 text-center">
            <ClipboardList size={28} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">記入対象がありません。</p>
            <p className="text-xs text-ink/40 mt-1">「稼働報告必須」の設定（タレント台帳）または案件へのアサイン（原価管理）と、CRMアカウントの紐付けを管理者にご確認ください。</p>
          </div>
        </Section>
      ) : (
        <>
          {/* 今月のサマリー(案件ごとの予定ペース比) */}
          <div className="mb-4 flex flex-wrap gap-2">
            {assignments.map((a) => {
              const planned = a.planned_months.find((m) => m.month === monthKeyStr)?.hours ?? 0;
              const actual = monthHours.get(a.assignment_id) ?? 0;
              const diff = actual - planned * elapsedRatio;
              return (
                <div key={a.assignment_id} className="rounded-xl border border-black/[0.06] px-3 py-2 text-xs">
                  <div className="font-medium text-ink/85 mb-0.5">{a.account_name ? `${a.account_name}｜` : ""}{a.opp_name}</div>
                  <div className="flex items-center gap-2.5 tabular-nums text-ink/65">
                    <span>{Number(monthKeyStr.slice(5, 7))}月予定 <b>{planned ? formatHoursHM(planned) : "未設定"}</b></span>
                    <span>実績 <b>{formatHoursHM(actual)}</b></span>
                    {planned > 0 && (
                      <span
                        className={`pill text-[10px] font-bold ${Math.abs(diff) < 0.01 ? "bg-mist-soft text-ink/55" : diff > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}
                        title="今日時点の按分予定(月の経過日数割合×月間予定)との差。＋は予定より速いペースで工数を消化"
                      >
                        ペース {diff >= 0 ? "+" : "−"}{formatHoursHM(Math.abs(diff))}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {generalRequired && (
              <div className="rounded-xl border border-black/[0.06] px-3 py-2 text-xs">
                <div className="font-medium text-ink/85 mb-0.5">全般稼働（案件なし）</div>
                <div className="tabular-nums text-ink/65">{Number(monthKeyStr.slice(5, 7))}月実績 <b>{formatHoursHM(generalMonthHours)}</b></div>
              </div>
            )}
          </div>

          {/* 週の状態(単位ごと) */}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            {allUnits.map((u) => {
              const w = weekByUnit.get(u.key);
              if (!w) return null;
              const p = STATUS_PILL[w.status];
              return (
                <span key={u.key} className="inline-flex items-center gap-1.5">
                  <span className="text-ink/55">{u.label}:</span>
                  <span className={`pill ${p.cls} text-[10px] font-bold`}>{p.label}</span>
                  {w.status === "returned" && w.review_note && <span className="text-rose-600">({w.review_note})</span>}
                </span>
              );
            })}
          </div>

          {editableUnits.length > 0 && (
            <Section title="この週の記入" className="mb-5">
              <WorkWeekEditor
                units={editableUnits}
                weekStart={week}
                days={days}
                initial={editableEntries}
                hasLockedUnits={lockedUnits.length > 0}
              />
            </Section>
          )}

          {lockedUnits.map((u) => {
            const es = entries.filter((e) => unitKeyOf(e) === u.key);
            const w = weekByUnit.get(u.key);
            const p = w ? STATUS_PILL[w.status] : null;
            return (
              <Section key={u.key} title={`${u.label}（${p?.label ?? ""}）`} className="mb-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 980 }}>
                    <thead className="text-ink/40 text-xs bg-mist-soft/30">
                      <tr>
                        <th className="th">日付</th><th className="th text-right">稼働時間</th><th className="th">タスク</th>
                        <th className="th">成果</th><th className="th">Next Action</th><th className="th">リスク・懸念</th><th className="th">メモ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04]">
                      {es.map((e: WorkEntry) => (
                        <tr key={e.id}>
                          <td className="td whitespace-nowrap">{dayLabel(e.work_date)}</td>
                          <td className="td text-right tabular-nums">{formatHoursHM(Number(e.hours) || 0)}</td>
                          <td className="td text-xs">{e.task_text ?? "—"}</td>
                          <td className="td text-xs">{e.outcome_text ?? "—"}</td>
                          <td className="td text-xs">{e.next_action_text ?? "—"}</td>
                          <td className="td text-xs">{e.risk_text ?? "—"}</td>
                          <td className="td text-xs">{e.memo ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-sm tabular-nums text-ink/70">
                  週合計 <span className="font-bold">{formatHoursHM(es.reduce((s, e) => s + (Number(e.hours) || 0), 0))}</span>
                  <span className="ml-3 text-xs text-ink/45">{w?.status === "approved" ? "承認済みのため編集できません" : "提出済み（承認待ち）のため編集できません"}</span>
                </div>
              </Section>
            );
          })}

          {/* CSV取込(スプレッドシート運用の継続) */}
          <Section title="CSV/TSV取込（スプレッドシートからの移し込み）" className="mb-5">
            <form action={importWorkCsvAction} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">稼働実績ファイル（CSV / TSV、2MBまで）</label>
                <input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" required className="input" />
              </div>
              <SubmitButton className="btn-primary inline-flex items-center gap-1.5 text-sm" pendingLabel="取込中…">
                <FileUp size={14} /> 取り込む
              </SubmitButton>
            </form>
            <div className="mt-2.5 text-xs text-ink/45 space-y-1">
              <p>・「日付」「稼働時間」列を含むヘッダー行があれば、上の行にタイトル等があっても自動で認識します。「案件名」「タスク」「成果」「Next Action」「リスク・懸念」「メモ」列も取り込みます。</p>
              <p>・案件名は紐づいている案件（{allUnits.filter((u) => u.key !== GENERAL_UNIT).map((u) => u.label).join(" / ") || "なし"}）に自動マッチし、一致しないもの・空欄は全般稼働に入ります（元の案件名はタスク欄に保全）。</p>
              <p>・日付から週を自動判定して<b>下書きに追記</b>します（既存の行は消しません）。提出済み・承認済みの週はスキップされます。取込後に内容を確認し、週ごとに提出してください。</p>
            </div>
          </Section>
        </>
      )}

      <p className="text-xs text-ink/40 mt-2">
        稼働時間は「1.5」(時間の小数) または「1:30」(時:分) で入力できます。ペースが
        <span className="text-rose-600 font-semibold"> ＋</span>のときは予定より速いペースで工数を消化しています（
        <span className="text-emerald-700 font-semibold">−</span>は余裕あり）。
      </p>
    </div>
  );
}
