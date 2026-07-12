import { requireBoCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createTrainingSessionAction, importSurveyResponsesAction, deleteTrainingSessionAction } from "@/server/actions/bo";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

interface SessionRow { id: string; held_on: string; course: string; instructor: string; account_name: string | null; attendee_count: number | null; }
interface Resp { session_id: string; role_level: string | null; satisfaction: number | null; understanding: number | null; instructor_score: number | null; nps: number | null; comment: string | null; }

const ROLE_LABEL: Record<string, string> = { exec: "経営層", manager: "管理職", staff: "一般" };

function avg(ns: (number | null)[]): string {
  const v = ns.filter((n): n is number => n != null);
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "—";
}

function StatTable({ title, groups }: { title: string; groups: Map<string, Resp[]> }) {
  return (
    <Section title={title}>
      {groups.size === 0 ? (
        <p className="text-sm text-ink/40 py-3 text-center">データがありません</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-ink/40 text-left"><th className="pb-1.5">区分</th><th className="pb-1.5 text-right">回答</th><th className="pb-1.5 text-right">満足度</th><th className="pb-1.5 text-right">理解度</th><th className="pb-1.5 text-right">講師評価</th><th className="pb-1.5 text-right">NPS</th></tr></thead>
          <tbody>
            {Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => (
              <tr key={k} className="border-t border-black/[0.04]">
                <td className="py-1.5">{k}</td>
                <td className="py-1.5 text-right tabular-nums">{rs.length}</td>
                <td className="py-1.5 text-right tabular-nums">{avg(rs.map((r) => r.satisfaction))}</td>
                <td className="py-1.5 text-right tabular-nums">{avg(rs.map((r) => r.understanding))}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold">{avg(rs.map((r) => r.instructor_score))}</td>
                <td className="py-1.5 text-right tabular-nums">{avg(rs.map((r) => r.nps))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** BO-3 講師アンケート分析: 講師別・研修種類別・受講者層別。 */
export default async function SurveysPage() {
  await requireBoCtx();
  const sb = getSupabaseServer();
  const [sessR, respR] = await Promise.all([
    sb.from("training_sessions").select("id, held_on, course, instructor, account_name, attendee_count").order("held_on", { ascending: false }).limit(200),
    sb.from("training_survey_responses").select("session_id, role_level, satisfaction, understanding, instructor_score, nps, comment").limit(10000),
  ]);
  const sessions = (sessR.data ?? []) as SessionRow[];
  const responses = (respR.data ?? []) as Resp[];
  const byId = new Map(sessions.map((s) => [s.id, s]));

  const groupBy = (key: (r: Resp) => string | null) => {
    const m = new Map<string, Resp[]>();
    for (const r of responses) {
      const k = key(r);
      if (!k) continue;
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return m;
  };
  const byInstructor = groupBy((r) => byId.get(r.session_id)?.instructor ?? null);
  const byCourse = groupBy((r) => byId.get(r.session_id)?.course ?? null);
  const byRole = groupBy((r) => (r.role_level ? ROLE_LABEL[r.role_level] ?? r.role_level : null));
  const lowRated = responses.filter((r) => (r.satisfaction ?? 5) <= 2 || (r.instructor_score ?? 5) <= 2);

  return (
    <div className="max-w-4xl">
      <PageHeader title="講師アンケート分析" subtitle="研修後アンケートを取り込み、講師別・研修種類別・受講者層別に品質を可視化します。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">研修実施回</div><div className="stat-value mt-1">{sessions.length}</div></Card>
        <Card><div className="text-xs text-ink/50">回答数</div><div className="stat-value mt-1">{responses.length}</div></Card>
        <Card><div className="text-xs text-ink/50">低評価(≦2)</div><div className={`stat-value mt-1 ${lowRated.length ? "text-rose-600" : ""}`}>{lowRated.length}</div></Card>
      </div>

      <Section title="研修(実施回)を登録" className="mb-5">
        <form action={createTrainingSessionAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">実施日 *</label><input name="held_on" type="date" required className="input w-auto" /></div>
          <div><label className="label">研修種類 *</label><input name="course" required className="input" placeholder="例: 生成AI基礎" /></div>
          <div><label className="label">講師 *</label><input name="instructor" required className="input" placeholder="例: 山田" /></div>
          <div><label className="label">受講企業</label><input name="account_name" className="input" /></div>
          <div><label className="label">受講者数</label><input name="attendee_count" type="number" min={0} className="input w-24" /></div>
          <SubmitButton className="btn-accent" pendingLabel="登録中…">登録</SubmitButton>
        </form>
      </Section>

      <Section title={`実施回と回答取込（${sessions.length}）`} className="mb-5">
        {sessions.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">実施回を登録すると、ここから回答を貼り付けて取り込めます</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => {
              const n = responses.filter((r) => r.session_id === s.id).length;
              return (
                <li key={s.id} className="rounded-xl border border-black/[0.05] p-3">
                  <div className="flex items-center gap-2.5 flex-wrap text-sm">
                    <span className="text-xs tabular-nums text-ink/45">{s.held_on}</span>
                    <span className="font-medium">{s.course}</span>
                    <span className="pill bg-teal-light text-teal-deep">{s.instructor}</span>
                    {s.account_name && <span className="text-xs text-ink/45">{s.account_name}</span>}
                    <span className="text-xs text-ink/40 ml-auto">回答 {n}件{s.attendee_count ? ` / ${s.attendee_count}名` : ""}</span>
                    <form action={deleteTrainingSessionAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton className="text-xs text-rose-500 hover:underline" pendingLabel="保存中…">削除</SubmitButton>
                    </form>
                  </div>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-teal-deep">＋ 回答を貼り付けて取込</summary>
                    <form action={importSurveyResponsesAction} className="mt-2 space-y-2">
                      <input type="hidden" name="session_id" value={s.id} />
                      <textarea name="rows" rows={4} className="input text-xs font-mono" placeholder={"1行=1回答（タブ/カンマ区切り）:\n役職層(経営/管理職/一般), 職種, 年代, 満足度1-5, 理解度1-5, 講師評価1-5, NPS0-10, 自由記述\n例: 管理職,営業,40代,5,4,5,9,実務に直結して良かった"} />
                      <SubmitButton className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[0.03]" pendingLabel="取込中…">取込</SubmitButton>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <StatTable title="講師別" groups={byInstructor} />
        <StatTable title="研修種類別" groups={byCourse} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <StatTable title="受講者層別（役職層）" groups={byRole} />
        <Section title={`低評価コメント（満足度/講師評価 ≦2）`}>
          {lowRated.length === 0 ? (
            <p className="text-sm text-ink/40 py-3 text-center">低評価はありません 🎉</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto text-sm">
              {lowRated.slice(0, 30).map((r, i) => {
                const s = byId.get(r.session_id);
                return (
                  <li key={i} className="border-b border-black/[0.04] pb-1.5">
                    <span className="text-xs text-ink/45">{s?.held_on} {s?.course}（{s?.instructor}） 満足度{r.satisfaction ?? "—"}/講師{r.instructor_score ?? "—"}</span>
                    {r.comment && <p className="text-ink/75 mt-0.5">{r.comment}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
