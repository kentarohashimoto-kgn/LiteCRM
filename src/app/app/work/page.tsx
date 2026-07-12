import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getMyWorkContext, getMyWorkWeek, type WorkWeekStatus, type WorkWeek } from "@/lib/data/work-log";
import { todayJST, weekStartOf, addDaysISO, monthEndOf, formatHoursHM } from "@/lib/work-time";
import { PageHeader, Section } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { WorkWeekEditor } from "@/components/work/work-week-editor";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<WorkWeekStatus, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-mist-soft text-ink/55" },
  submitted: { label: "提出済み（承認待ち）", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "承認済み", cls: "bg-emerald-50 text-emerald-700" },
  returned: { label: "差戻し（修正して再提出）", cls: "bg-rose-50 text-rose-600" },
};

const fmtMD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 担当者の稼働実績 記入ページ(週次)。外部委託・フリーランス・社内メンバー共用。 */
export default async function WorkPage({ searchParams }: { searchParams: { week?: string; saved?: string; error?: string } }) {
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
  const weekByAssignment = new Map(weeks.filter((w) => w.assignment_id).map((w) => [w.assignment_id!, w]));
  const generalWeek: WorkWeek | null = weeks.find((w) => !w.assignment_id) ?? null;
  const generalEntries = entries.filter((e) => !e.assignment_id);

  // 当月の経過割合(按分ペースの計算用)。過去月=1、未来月=0。
  const elapsedRatio =
    today >= monthEnd ? 1 : today < monthStart ? 0 : (Number(today.slice(8, 10))) / Number(monthEnd.slice(8, 10));

  return (
    <div>
      <PageHeader
        title="稼働報告"
        subtitle="担当している案件の稼働実績を日次で記入し、週ごとに提出してください。承認された実績は原価管理・月次請求の元データになります。"
        action={
          <div className="flex items-center gap-1.5 text-sm">
            <Link href={`/app/work?week=${addDaysISO(week, -7)}`} className="btn-ghost px-2 py-1" aria-label="前の週"><ChevronLeft size={15} /></Link>
            <span className="font-semibold text-ink/80 tabular-nums">{week.slice(0, 4)}年 {fmtMD(week)}〜{fmtMD(weekEnd)} の週</span>
            <Link href={`/app/work?week=${addDaysISO(week, 7)}`} className="btn-ghost px-2 py-1" aria-label="次の週"><ChevronRight size={15} /></Link>
            <Link href="/app/work" className="btn-ghost text-xs">今週へ</Link>
          </div>
        }
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          work: "下書きを保存しました。週の記入が終わったら「この週を提出」を押してください。",
          submit: "提出しました。承認されるまで編集はロックされます。",
        }}
        errorMessages={{
          locked: "この週は提出済み・承認済みのため編集できません。修正が必要な場合は管理者に差戻しを依頼してください。",
          empty: "記入行がありません。先に実績を記入して「下書き保存」してください。",
          invalid: "入力内容が不正です。",
          load_failed: "データの読み込みに失敗しました。再度お試しください。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      {assignments.length === 0 && !generalRequired ? (
        <Section title="">
          <div className="py-12 text-center">
            <ClipboardList size={28} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">記入対象がありません。</p>
            <p className="text-xs text-ink/40 mt-1">「稼働報告必須」の設定（タレント台帳）または案件へのアサイン（原価管理）と、CRMアカウントの紐付けを管理者にご確認ください。</p>
          </div>
        </Section>
      ) : (
        assignments.map((a) => {
          const wk = weekByAssignment.get(a.assignment_id) ?? null;
          const st = wk?.status ?? null;
          const pill = st ? STATUS_PILL[st] : null;
          const planned = a.planned_months.find((m) => m.month === monthKeyStr)?.hours ?? 0;
          const actual = monthHours.get(a.assignment_id) ?? 0;
          const expected = planned * elapsedRatio;
          const diff = actual - expected;
          const remaining = planned - actual;
          return (
            <Section
              key={a.assignment_id}
              title={`${a.account_name ? a.account_name + "｜" : ""}${a.opp_name}${a.role ? `（${a.role}）` : ""}`}
              className="mb-5"
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {pill && <span className={`pill ${pill.cls} text-[11px] font-bold`}>{pill.label}</span>}
                {st === "returned" && wk?.review_note && (
                  <span className="text-xs text-rose-600">差戻し理由: {wk.review_note}</span>
                )}
                <span className="tabular-nums text-ink/70">
                  {Number(monthKeyStr.slice(5, 7))}月の予定 <b>{planned ? formatHoursHM(planned) : "未設定"}</b>
                </span>
                <span className="tabular-nums text-ink/70">実績入力 <b>{formatHoursHM(actual)}</b></span>
                {planned > 0 && (
                  <>
                    <span className="tabular-nums text-ink/70">残り <b>{formatHoursHM(Math.max(0, remaining))}</b></span>
                    <span
                      className={`pill text-[11px] font-bold tabular-nums ${
                        Math.abs(diff) < 0.01 ? "bg-mist-soft text-ink/55" : diff > 0 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"
                      }`}
                      title="今日時点の按分予定(月の経過日数割合×月間予定)との差"
                    >
                      予定ペース比 {diff >= 0 ? "+" : "−"}{formatHoursHM(Math.abs(diff))}
                    </span>
                  </>
                )}
              </div>
              <WorkWeekEditor
                assignmentId={a.assignment_id}
                planId={a.plan_id}
                weekStart={week}
                days={days}
                initial={entries.filter((e) => e.assignment_id === a.assignment_id)}
                status={st}
              />
            </Section>
          );
        })
      )}

      {generalRequired && (
        <Section title="全般稼働（案件に紐づかない稼働）" className="mb-5">
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {generalWeek && <span className={`pill ${STATUS_PILL[generalWeek.status].cls} text-[11px] font-bold`}>{STATUS_PILL[generalWeek.status].label}</span>}
            {generalWeek?.status === "returned" && generalWeek.review_note && (
              <span className="text-xs text-rose-600">差戻し理由: {generalWeek.review_note}</span>
            )}
            <span className="tabular-nums text-ink/70">
              {Number(monthKeyStr.slice(5, 7))}月の実績入力 <b>{formatHoursHM(generalMonthHours)}</b>
            </span>
            <span className="text-xs text-ink/45">営業活動・社内業務など、特定案件の原価に紐づかない稼働はこちらに記入してください。</span>
          </div>
          <WorkWeekEditor
            talentId={talent!.talent_id}
            weekStart={week}
            days={days}
            initial={generalEntries}
            status={generalWeek?.status ?? null}
          />
        </Section>
      )}

      <p className="text-xs text-ink/40 mt-2">
        稼働時間は「1.5」(時間の小数) または「1:30」(時:分) で入力できます。予定ペース比が
        <span className="text-rose-600 font-semibold"> ＋</span>のときは予定より速いペースで工数を消化しています（
        <span className="text-emerald-700 font-semibold">−</span>は余裕あり）。
      </p>
    </div>
  );
}
