import Link from "next/link";
import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createInstructorAction, updateInstructorAction, scheduleTrainingSessionAction } from "@/server/actions/bo";

export const dynamic = "force-dynamic";

interface Instructor { id: string; name: string; schedule_url: string | null; email: string | null; color: string | null; active: boolean; notes: string | null; }
interface Sess {
  id: string; held_on: string; start_time: string | null; end_time: string | null;
  course: string; instructor: string; instructor_id: string | null; account_name: string | null; venue: string | null;
}

// 講師ごとの色(登録色が無ければ順番で自動割当)
const PALETTE = [
  "bg-teal-500 text-white", "bg-indigo-500 text-white", "bg-rose-500 text-white", "bg-amber-500 text-white",
  "bg-emerald-500 text-white", "bg-sky-500 text-white", "bg-fuchsia-500 text-white", "bg-lime-600 text-white",
];

function monthAdd(ym: string, diff: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + diff, 1)).toISOString().slice(0, 7);
}
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** BO-7 AI講師スケジュール: 講師の日程URLを登録し、研修予定をカレンダーで俯瞰。 */
export default async function InstructorsPage({ searchParams }: { searchParams: { month?: string } }) {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? (searchParams.month as string) : today.slice(0, 7);

  const [insR, sessR] = await Promise.all([
    sb.from("instructors").select("id, name, schedule_url, email, color, active, notes").order("name").limit(200),
    sb.from("training_sessions").select("id, held_on, start_time, end_time, course, instructor, instructor_id, account_name, venue")
      .gte("held_on", `${monthAdd(month, -1)}-01`).lte("held_on", `${monthAdd(month, 2)}-01`).order("held_on").limit(500),
  ]);
  const instructors = (insR.data ?? []) as Instructor[];
  const sessions = (sessR.data ?? []) as Sess[];

  // 講師→色
  const colorOf = new Map<string, string>();
  instructors.forEach((ins, i) => colorOf.set(ins.id, ins.color || PALETTE[i % PALETTE.length]));
  const toneFor = (s: Sess) => (s.instructor_id && colorOf.get(s.instructor_id)) || "bg-ink/60 text-white";

  // カレンダー(月)
  const [cy, cm] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(cy, cm - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
  const byDate = new Map<string, Sess[]>();
  for (const s of sessions) (byDate.get(s.held_on) ?? byDate.set(s.held_on, []).get(s.held_on)!).push(s);
  for (const arr of byDate.values()) arr.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));

  const monthSessions = sessions.filter((s) => s.held_on.slice(0, 7) === month);

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
                    <option value="bg-teal-500 text-white">ティール</option>
                    <option value="bg-indigo-500 text-white">インディゴ</option>
                    <option value="bg-rose-500 text-white">ローズ</option>
                    <option value="bg-amber-500 text-white">アンバー</option>
                    <option value="bg-emerald-500 text-white">グリーン</option>
                    <option value="bg-sky-500 text-white">スカイ</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn-accent">登録</button>
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
                      <button type="submit" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/[0.03]">保存</button>
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="研修予定を登録">
            <form action={scheduleTrainingSessionAction} className="space-y-2.5">
              <div><label className="label">実施日 *</label><input name="held_on" type="date" required className="input" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">開始</label><input name="start_time" type="time" className="input" /></div>
                <div><label className="label">終了</label><input name="end_time" type="time" className="input" /></div>
              </div>
              <div><label className="label">講師</label>
                <select name="instructor_id" className="input" defaultValue="">
                  <option value="">（未定）</option>
                  {instructors.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div><label className="label">研修種類 *</label><input name="course" required className="input" placeholder="例: 生成AI基礎" /></div>
              <div><label className="label">受講企業</label><input name="account_name" className="input" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">会場</label><input name="venue" className="input" placeholder="訪問/オンライン等" /></div>
                <div><label className="label">受講者数</label><input name="attendee_count" type="number" min={0} className="input" /></div>
              </div>
              <button type="submit" className="btn-accent">予定を追加</button>
            </form>
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
        </div>
      </div>
    </div>
  );
}
