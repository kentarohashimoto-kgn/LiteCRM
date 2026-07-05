import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createTalentAction, updateTalentAction, addTalentReviewAction } from "@/server/actions/hr";

export const dynamic = "force-dynamic";

const EMP_LABEL: Record<string, string> = { employee: "社員", contractor: "業務委託", instructor: "講師" };

interface Talent {
  id: string; name: string; employment_type: string; skills: string | null;
  current_assignment: string | null; joined_on: string | null; left_on: string | null; notes: string | null;
}
interface Review {
  id: string; talent_id: string; period: string; reviewer: string | null;
  overall: number | null; comment: string | null; goals: string | null;
}

function stars(n: number | null): string {
  return n == null ? "—" : "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

/** BO-5 タレント台帳・稼働中評価: 社員/業務委託/講師の稼働状況と期別評価。 */
export default async function TalentsPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [talR, revR] = await Promise.all([
    sb.from("talents").select("id, name, employment_type, skills, current_assignment, joined_on, left_on, notes").order("created_at", { ascending: false }).limit(300),
    sb.from("talent_reviews").select("id, talent_id, period, reviewer, overall, comment, goals").order("created_at", { ascending: false }).limit(1000),
  ]);
  const talents = (talR.data ?? []) as Talent[];
  const reviews = (revR.data ?? []) as Review[];
  const revByTalent = new Map<string, Review[]>();
  for (const r of reviews) {
    (revByTalent.get(r.talent_id) ?? revByTalent.set(r.talent_id, []).get(r.talent_id)!).push(r);
  }
  const activeTalents = talents.filter((t) => !t.left_on);
  const unassigned = activeTalents.filter((t) => !t.current_assignment);

  return (
    <div className="max-w-4xl">
      <PageHeader title="タレント台帳・評価" subtitle="稼働人員（社員・業務委託・講師）の台帳と、期ごとの稼働中評価を管理します。" />

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">稼働中</div><div className="stat-value mt-1">{activeTalents.length}</div></Card>
        <Card><div className="text-xs text-ink/50">アサイン待ち</div><div className={`stat-value mt-1 ${unassigned.length ? "text-amber-600" : ""}`}>{unassigned.length}</div></Card>
        <Card><div className="text-xs text-ink/50">評価記録</div><div className="stat-value mt-1">{reviews.length}</div></Card>
      </div>

      <Section title="タレントを追加" className="mb-5">
        <form action={createTalentAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">氏名 *</label><input name="name" required className="input" /></div>
          <div>
            <label className="label">区分</label>
            <select name="employment_type" className="input w-auto" defaultValue="employee">
              <option value="employee">社員</option>
              <option value="contractor">業務委託</option>
              <option value="instructor">講師</option>
            </select>
          </div>
          <div><label className="label">スキル</label><input name="skills" className="input" placeholder="例: 生成AI研修, Python" /></div>
          <div><label className="label">現在の稼働先</label><input name="current_assignment" className="input" /></div>
          <div><label className="label">稼働開始日</label><input name="joined_on" type="date" className="input w-auto" /></div>
          <button type="submit" className="btn-accent">追加</button>
        </form>
        <p className="text-xs text-ink/40 mt-2">※ 候補者ページで「入社・稼働」にすると自動でここに追加されます</p>
      </Section>

      <Section title={`台帳（${talents.length}）`}>
        {talents.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">タレントがまだいません</p>
        ) : (
          <ul className="space-y-3">
            {talents.map((t) => {
              const revs = revByTalent.get(t.id) ?? [];
              const latest = revs[0];
              return (
                <li key={t.id} className={`rounded-xl border border-black/[0.05] p-3 ${t.left_on ? "opacity-55" : ""}`}>
                  <form action={updateTalentAction} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <div className="flex items-center gap-2.5 flex-wrap text-sm">
                      <span className="font-medium">{t.name}</span>
                      <select name="employment_type" defaultValue={t.employment_type} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs">
                        {Object.entries(EMP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {t.joined_on && <span className="text-xs text-ink/40 tabular-nums">{t.joined_on}〜{t.left_on ?? ""}</span>}
                      {latest && <span className="text-xs text-amber-600" title={`${latest.period} の総合評価`}>{stars(latest.overall)}</span>}
                      <span className="ml-auto" />
                      <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">保存</button>
                      {!t.left_on && <button name="op" value="leave" className="text-xs text-ink/45 hover:underline">退職・終了</button>}
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <input name="skills" defaultValue={t.skills ?? ""} className="input flex-1 min-w-[180px] text-xs py-1.5" placeholder="スキル" />
                      <input name="current_assignment" defaultValue={t.current_assignment ?? ""} className="input flex-1 min-w-[160px] text-xs py-1.5" placeholder="現在の稼働先" />
                      <input name="notes" defaultValue={t.notes ?? ""} className="input flex-1 min-w-[160px] text-xs py-1.5" placeholder="メモ" />
                    </div>
                  </form>

                  {revs.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-ink/60">
                      {revs.slice(0, 3).map((r) => (
                        <li key={r.id} className="flex items-center gap-2 flex-wrap">
                          <span className="pill bg-black/[0.04] text-ink/60">{r.period}</span>
                          <span className="text-amber-600">{stars(r.overall)}</span>
                          {r.reviewer && <span>評価者: {r.reviewer}</span>}
                          {r.comment && <span className="text-ink/45">{r.comment}</span>}
                          {r.goals && <span className="text-ink/45">次期: {r.goals}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-teal-deep">＋ 評価を記録</summary>
                    <form action={addTalentReviewAction} className="mt-2 flex items-end gap-2 flex-wrap">
                      <input type="hidden" name="talent_id" value={t.id} />
                      <div><label className="label">期間 *</label><input name="period" required className="input w-28 text-xs" placeholder="2026H2" /></div>
                      <div>
                        <label className="label">総合1-5</label>
                        <select name="overall" className="input w-auto text-xs" defaultValue="3">
                          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div><label className="label">評価者</label><input name="reviewer" className="input w-28 text-xs" /></div>
                      <div className="min-w-[160px] flex-1"><label className="label">コメント</label><input name="comment" className="input text-xs" /></div>
                      <div className="min-w-[160px] flex-1"><label className="label">次期目標</label><input name="goals" className="input text-xs" /></div>
                      <button type="submit" className="rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[0.03]">記録</button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
