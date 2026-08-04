import Link from "next/link";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createInstructorAction, updateInstructorAction, updateTrainingSessionAction, deleteTrainingSessionAction } from "@/server/actions/bo";
import { ScheduleSessionForm } from "@/components/bo/schedule-session-form";
import { InstructorHoursBar, InstructorHoursTrend } from "@/components/bo/instructor-hours-charts";
import { ExternalLink, ChevronDown } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

interface Instructor { id: string; name: string; schedule_url: string | null; email: string | null; color: string | null; active: boolean; notes: string | null; }
interface Sess {
  id: string; held_on: string; start_time: string | null; end_time: string | null;
  course: string; instructor: string; instructor_id: string | null; account_name: string | null; venue: string | null;
  session_part?: string | null; meeting_url?: string | null;
}

// 講師ごとの色(登録色が無ければ順番で自動割当)。カレンダーとグラフで同じ色を使う。
// ※ tailwind.configでtealは独自定義(primary/deep/light)のため teal-500 は使わない
const PALETTE = [
  "bg-teal-primary text-white", "bg-indigo-500 text-white", "bg-rose-500 text-white", "bg-amber-500 text-white",
  "bg-emerald-500 text-white", "bg-sky-500 text-white", "bg-fuchsia-500 text-white", "bg-lime-600 text-white",
];
// PALETTE と同じ並びの16進(recharts用)
const HEX = ["#008C8C", "#6366f1", "#f43f5e", "#f59e0b", "#10b981", "#0ea5e9", "#d946ef", "#65a30d"];
// 登録色クラス→16進の対応
const CLASS_HEX: Record<string, string> = {
  "bg-teal-primary text-white": "#008C8C", "bg-indigo-500 text-white": "#6366f1", "bg-rose-500 text-white": "#f43f5e",
  "bg-amber-500 text-white": "#f59e0b", "bg-emerald-500 text-white": "#10b981", "bg-sky-500 text-white": "#0ea5e9",
};

function monthAdd(ym: string, diff: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + diff, 1)).toISOString().slice(0, 7);
}
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** 開始/終了(HH:MM[:SS])から稼働時間(h)。両方揃っているものだけ計上。 */
function durationHours(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const d = toMin(end) - toMin(start);
  return d > 0 ? Math.round((d / 60) * 100) / 100 : 0;
}

/** BO-7 AI講師スケジュール: 講師の日程URLを登録し、研修予定をカレンダーで俯瞰。 */
export default async function InstructorsPage(props: { searchParams: Promise<{ month?: string }> }) {
  const searchParams = await props.searchParams;
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? (searchParams.month as string) : today.slice(0, 7);

  // グラフ用: 直近6ヶ月(選択月を最終月)の稼働時間を集計
  const TREND_MONTHS = 6;
  const trendStart = monthAdd(month, -(TREND_MONTHS - 1));

  const [insR, sessR, dealsR, hoursR, listR] = await Promise.all([
    sb.from("instructors").select("id, name, schedule_url, email, color, active, notes").order("name").limit(200),
    sb.from("training_sessions").select("id, held_on, start_time, end_time, course, instructor, instructor_id, account_name, venue, session_part, meeting_url")
      .gte("held_on", `${monthAdd(month, -1)}-01`).lte("held_on", `${monthAdd(month, 2)}-01`).order("held_on").limit(500),
    sb.rpc("bo_training_deals"),
    sb.from("training_sessions").select("held_on, start_time, end_time, instructor_id")
      .gte("held_on", `${trendStart}-01`).lte("held_on", `${monthAdd(month, 1)}-01`).limit(5000),
    // 一覧・クライアント別集約(月に依存しない・直近45日以降の実施予定)
    sb.from("training_sessions").select("id, held_on, start_time, end_time, course, instructor, instructor_id, account_name, venue, session_part, meeting_url")
      .gte("held_on", new Date(Date.now() + 9 * 3600 * 1000 - 45 * 86400 * 1000).toISOString().slice(0, 10))
      .order("held_on").order("start_time").limit(500),
  ]);
  const instructors = (insR.data ?? []) as Instructor[];
  const sessions = (sessR.data ?? []) as Sess[];
  const listSessions = (listR.data ?? []) as Sess[];
  const deals = ((dealsR.data ?? []) as { account_name: string | null; name: string }[]);
  const hoursRows = (hoursR.data ?? []) as { held_on: string; start_time: string | null; end_time: string | null; instructor_id: string | null }[];

  // 講師→色(class/hex)
  const colorOf = new Map<string, string>();
  const hexOf = new Map<string, string>();
  instructors.forEach((ins, i) => {
    colorOf.set(ins.id, ins.color || PALETTE[i % PALETTE.length]);
    hexOf.set(ins.id, (ins.color && CLASS_HEX[ins.color]) || HEX[i % HEX.length]);
  });
  const nameOf = new Map(instructors.map((ins) => [ins.id, ins.name]));
  const toneFor = (s: Sess) => (s.instructor_id && colorOf.get(s.instructor_id)) || "bg-ink/60 text-white";

  // 月リスト(古い→新しい)
  const trendMonthList = Array.from({ length: TREND_MONTHS }, (_, i) => monthAdd(trendStart, i));
  // 講師×月の稼働時間
  const hoursByInsMonth = new Map<string, Map<string, number>>(); // insId -> ym -> hours
  for (const r of hoursRows) {
    if (!r.instructor_id) continue;
    const ym = r.held_on.slice(0, 7);
    const h = durationHours(r.start_time, r.end_time);
    if (h <= 0) continue;
    const m = hoursByInsMonth.get(r.instructor_id) ?? new Map<string, number>();
    m.set(ym, (m.get(ym) ?? 0) + h);
    hoursByInsMonth.set(r.instructor_id, m);
  }
  // 期間内に稼働のある講師のみグラフ対象
  const chartInstructors = instructors.filter((ins) => {
    const m = hoursByInsMonth.get(ins.id);
    return m && Array.from(m.values()).some((v) => v > 0);
  });
  const chartSeries = chartInstructors.map((ins) => ({ key: ins.id, name: ins.name, color: hexOf.get(ins.id) ?? "#008C8C" }));
  // 棒(選択月): 講師別の稼働時間
  const barData = chartInstructors
    .map((ins) => ({ name: ins.name, hours: hoursByInsMonth.get(ins.id)?.get(month) ?? 0, color: hexOf.get(ins.id) ?? "#008C8C" }))
    .filter((d) => d.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  // 折れ線(6ヶ月): 月ごとに講師別の稼働時間
  const trendData = trendMonthList.map((ym) => {
    const row: Record<string, string | number> = { label: `${Number(ym.slice(5, 7))}月` };
    for (const ins of chartInstructors) row[ins.id] = hoursByInsMonth.get(ins.id)?.get(ym) ?? 0;
    return row;
  });

  // カレンダー(月)
  const [cy, cm] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const byDate = new Map<string, Sess[]>();
  for (const s of sessions) (byDate.get(s.held_on) ?? byDate.set(s.held_on, []).get(s.held_on)!).push(s);
  for (const arr of byDate.values()) arr.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  const monthSessions = sessions.filter((s) => s.held_on.slice(0, 7) === month);

  // 一覧・クライアント別集約(直近45日以降)
  const activeInstructors = instructors.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name }));
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  const fmtDate = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return `${m}/${dd}(${wd[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
  const partOf = (s: Sess, i: number) => (s.session_part?.trim() || `Day${i + 1}`);
  const clientGroups = (() => {
    const m = new Map<string, Sess[]>();
    for (const s of listSessions) {
      const k = s.account_name?.trim() || "(企業未設定)";
      (m.get(k) ?? m.set(k, []).get(k)!).push(s);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"));
  })();
  const dot = (s: Sess) => (s.instructor_id && (colorOf.get(s.instructor_id) || "").split(" ")[0]) || "bg-ink/40";

  return (
    <div>
      <PageHeader title="AI講師スケジュール" subtitle="講師の日程調整URLを登録し、どの講師がいつ・どの企業で研修を実施するかをカレンダーで俯瞰します。" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">登録講師</div><div className="stat-value mt-1">{instructors.filter((i) => i.active).length}</div></Card>
        <Card><div className="text-xs text-ink/50">日程URL登録済</div><div className="stat-value mt-1">{instructors.filter((i) => i.schedule_url).length}</div></Card>
        <Card><div className="text-xs text-ink/50">今月の研修</div><div className="stat-value mt-1">{monthSessions.length}<span className="stat-unit">件</span></div></Card>
        <Card><div className="text-xs text-ink/50">時刻未設定</div><div className="stat-value mt-1">{monthSessions.filter((s) => !s.start_time).length}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* 講師マスタ */}
        <div className="lg:col-span-1 space-y-5">
          <Section title="講師を登録">
            <form action={createInstructorAction} className="space-y-2.5">
              <div><label className="label">講師名 *</label><input name="name" required className="input" /></div>
              <div><label className="label">日程調整URL</label><input name="schedule_url" className="input" placeholder="TimeRex / Calendly など" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">メール</label><input name="email" type="email" className="input" /></div>
                <div><label className="label">色</label>
                  <select name="color" className="input" defaultValue="">
                    <option value="">自動</option>
                    <option value="bg-teal-primary text-white">ティール</option>
                    <option value="bg-indigo-500 text-white">インディゴ</option>
                    <option value="bg-rose-500 text-white">ローズ</option>
                    <option value="bg-amber-500 text-white">アンバー</option>
                    <option value="bg-emerald-500 text-white">グリーン</option>
                    <option value="bg-sky-500 text-white">スカイ</option>
                  </select>
                </div>
              </div>
              <SubmitButton className="btn-accent" pendingLabel="登録中…">登録</SubmitButton>
            </form>
          </Section>

          <Section title={`講師一覧（${instructors.length}）`}>
            {instructors.length === 0 ? (
              <p className="text-sm text-ink/40 py-3 text-center">講師がまだ登録されていません</p>
            ) : (
              <ul className="space-y-2.5">
                {instructors.map((ins) => (
                  <li key={ins.id} className="rounded-xl border border-black/[0.05] p-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full shrink-0 ${(colorOf.get(ins.id) || "").split(" ")[0]}`} />
                      <span className="font-medium text-sm">{ins.name}</span>
                      {ins.schedule_url && (
                        <a href={ins.schedule_url} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-deep hover:underline ml-auto">日程URLを開く ↗</a>
                      )}
                    </div>
                    <form action={updateInstructorAction} className="mt-1.5 flex items-center gap-1.5">
                      <input type="hidden" name="id" value={ins.id} />
                      <input name="schedule_url" defaultValue={ins.schedule_url ?? ""} className="input text-xs py-1 flex-1" placeholder="日程調整URL" />
                      <SubmitButton className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="研修予定を登録">
            <ScheduleSessionForm instructors={instructors.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name }))} deals={deals} />
          </Section>
        </div>

        {/* カレンダー */}
        <div className="lg:col-span-2">
          <Section title="研修カレンダー">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Link href={`/app/bo/instructors?month=${monthAdd(month, -1)}`} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">← 前月</Link>
              <span className="font-medium text-sm tabular-nums">{cy}年{cm}月</span>
              <Link href={`/app/bo/instructors?month=${monthAdd(month, 1)}`} className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">翌月 →</Link>
              {month !== today.slice(0, 7) && <Link href="/app/bo/instructors" className="text-xs text-teal-deep hover:underline">今月へ</Link>}
            </div>
            {/* 講師の色凡例＋日程URL */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
              {instructors.filter((i) => i.active).map((ins) => (
                <span key={ins.id} className="inline-flex items-center gap-1 text-xs text-ink/60">
                  <span className={`h-2.5 w-2.5 rounded-full ${(colorOf.get(ins.id) || "").split(" ")[0]}`} />
                  {ins.schedule_url ? (
                    <a href={ins.schedule_url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-deep hover:underline">{ins.name} ↗</a>
                  ) : ins.name}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-black/[0.06] rounded-xl overflow-hidden border border-black/[0.06]">
              {["日", "月", "火", "水", "木", "金", "土"].map((d, i) => (
                <div key={d} className={`bg-white px-2 py-1.5 text-xs font-medium text-center ${i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-ink/50"}`}>{d}</div>
              ))}
              {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} className="bg-white min-h-[92px]" />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const date = `${month}-${String(day).padStart(2, "0")}`;
                const items = byDate.get(date) ?? [];
                return (
                  <div key={date} className={`bg-white min-h-[92px] p-1 ${date === today ? "ring-2 ring-inset ring-teal-primary/50" : ""}`}>
                    <div className={`text-[11px] tabular-nums ${date === today ? "font-bold text-teal-deep" : "text-ink/45"}`}>{day}</div>
                    <div className="space-y-0.5 mt-0.5">
                      {items.slice(0, 4).map((s) => (
                        <div key={s.id} className={`rounded px-1 py-0.5 text-[10px] leading-tight truncate ${toneFor(s)}`} title={`${hhmm(s.start_time)}${s.end_time ? "-" + hhmm(s.end_time) : ""} ${s.instructor}｜${s.account_name ?? ""}｜${s.course}${s.venue ? "（" + s.venue + "）" : ""}`}>
                          {s.start_time && <span className="tabular-nums font-semibold mr-0.5">{hhmm(s.start_time)}</span>}
                          {s.account_name || s.course}
                        </div>
                      ))}
                      {items.length > 4 && <div className="text-[10px] text-ink/40 px-1">他{items.length - 4}件</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-ink/40 mt-2">※ 色は講師別。バーにカーソルを当てると 時刻・講師・企業・研修・会場 が出ます。</p>
          </Section>

          {/* 講師の稼働時間グラフ(カレンダーの下) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
            <Section title={`講師別の稼働時間（${cy}年${cm}月）`} action={<span className="text-[11px] text-ink/40">担当者間のばらつきを見る</span>}>
              <InstructorHoursBar data={barData} monthLabel={`${cy}年${cm}月`} />
            </Section>
            <Section title={`稼働時間の推移（直近${trendMonthList.length}ヶ月・講師別）`} action={<span className="text-[11px] text-ink/40">増減トレンドで差配</span>}>
              <InstructorHoursTrend data={trendData} series={chartSeries} />
            </Section>
          </div>
          <p className="text-xs text-ink/40 mt-2">※ 稼働時間は各研修の「開始・終了時刻」から算出します。時刻未設定の回は集計に含まれません。</p>
        </div>
      </div>

      {/* 研修予定 一覧(時系列) */}
      <Section title={`研修予定 一覧（時系列・${listSessions.length}件）`} action={<span className="text-[11px] text-ink/40">直近45日以降の予定</span>} className="mb-5">
        {listSessions.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">予定はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="border-b border-black/[0.06]">
                <tr>
                  <th className="th">開催日</th><th className="th">時間</th><th className="th">クライアント</th>
                  <th className="th">研修</th><th className="th">パート</th><th className="th">講師</th>
                  <th className="th">会場</th><th className="th">会議URL</th><th className="th w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {listSessions.map((s, i) => (
                  <tr key={s.id} className="align-top">
                    <td className="td whitespace-nowrap tabular-nums">{fmtDate(s.held_on)}</td>
                    <td className="td whitespace-nowrap tabular-nums text-ink/70">{s.start_time ? `${hhmm(s.start_time)}${s.end_time ? "–" + hhmm(s.end_time) : ""}` : <span className="text-ink/30">未設定</span>}</td>
                    <td className="td font-medium">{s.account_name ?? "—"}</td>
                    <td className="td text-ink/70">{s.course}</td>
                    <td className="td"><span className="pill bg-mist-soft text-ink/60 text-[10px] whitespace-nowrap">{partOf(s, i)}</span></td>
                    <td className="td whitespace-nowrap"><span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${dot(s)}`} />{s.instructor}</span></td>
                    <td className="td text-ink/70">{s.venue ?? "—"}</td>
                    <td className="td">
                      {s.meeting_url ? (
                        <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal-deep hover:underline text-xs">開く <ExternalLink size={11} /></a>
                      ) : <span className="text-ink/30 text-xs">—</span>}
                    </td>
                    <td className="td">
                      <details>
                        <summary className="cursor-pointer text-xs text-ink/45 hover:text-teal-deep list-none inline-flex items-center gap-0.5">編集 <ChevronDown size={12} /></summary>
                        <form action={updateTrainingSessionAction} className="mt-2 space-y-1.5 rounded-lg border border-black/[0.06] bg-mist-soft/30 p-2 w-[260px]">
                          <input type="hidden" name="id" value={s.id} />
                          <div className="grid grid-cols-2 gap-1.5">
                            <div><label className="label text-[10px]">パート</label><input name="session_part" defaultValue={s.session_part ?? ""} className="input py-1 text-xs" placeholder="Day1" /></div>
                            <div><label className="label text-[10px]">会場</label><input name="venue" defaultValue={s.venue ?? ""} className="input py-1 text-xs" /></div>
                            <div><label className="label text-[10px]">開始</label><input name="start_time" type="time" defaultValue={hhmm(s.start_time)} className="input py-1 text-xs" /></div>
                            <div><label className="label text-[10px]">終了</label><input name="end_time" type="time" defaultValue={hhmm(s.end_time)} className="input py-1 text-xs" /></div>
                          </div>
                          <div><label className="label text-[10px]">講師</label>
                            <select name="instructor_id" defaultValue={s.instructor_id ?? ""} className="input py-1 text-xs">
                              <option value="">（未定）</option>
                              {activeInstructors.map((ins) => <option key={ins.id} value={ins.id}>{ins.name}</option>)}
                            </select>
                          </div>
                          <div><label className="label text-[10px]">会議URL</label><input name="meeting_url" type="url" defaultValue={s.meeting_url ?? ""} className="input py-1 text-xs" placeholder="Zoom / Teams" /></div>
                          <div className="flex items-center gap-2 pt-0.5">
                            <SubmitButton className="rounded-lg bg-teal-primary px-2.5 py-1 text-xs text-white" pendingLabel="保存中…">保存</SubmitButton>
                            <button formAction={deleteTrainingSessionAction} className="text-xs text-rose-500 hover:underline">削除</button>
                          </div>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* クライアント別スケジュール */}
      <Section title={`クライアント別スケジュール（${clientGroups.length}社）`} action={<span className="text-[11px] text-ink/40">Day1・Day2…の担当と会場を把握</span>}>
        {clientGroups.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">予定はありません</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {clientGroups.map(([client, list]) => (
              <div key={client} className="rounded-xl border border-black/[0.06] p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-semibold text-sm text-ink truncate">{client}</span>
                  <span className="text-[11px] text-ink/40 shrink-0 ml-2">{list.length}回</span>
                </div>
                <ol className="space-y-1.5">
                  {list.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 text-xs">
                      <span className="pill bg-teal-light text-teal-deep text-[10px] shrink-0 w-14 justify-center">{partOf(s, i)}</span>
                      <span className="tabular-nums text-ink/70 shrink-0 w-16">{fmtDate(s.held_on)}</span>
                      <span className="tabular-nums text-ink/45 shrink-0 w-20">{s.start_time ? `${hhmm(s.start_time)}${s.end_time ? "–" + hhmm(s.end_time) : ""}` : "—"}</span>
                      <span className="inline-flex items-center gap-1 shrink-0"><span className={`h-2 w-2 rounded-full ${dot(s)}`} />{s.instructor}</span>
                      <span className="text-ink/55 truncate flex-1">{s.venue ?? ""}</span>
                      {s.meeting_url && <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" className="text-teal-deep shrink-0" title="会議URL"><ExternalLink size={12} /></a>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
