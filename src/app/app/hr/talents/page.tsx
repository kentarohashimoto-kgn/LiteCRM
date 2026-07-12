import { requireHrCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getMembersLite } from "@/lib/data/workspace";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { createTalentAction, updateTalentAction, addTalentReviewAction } from "@/server/actions/hr";

export const dynamic = "force-dynamic";

const EMP_LABEL: Record<string, string> = { employee: "社員", contractor: "業務委託", instructor: "講師", company: "企業・代理店" };
const STATUS_OPTIONS = ["継続", "保留", "Ｘジム", "パフォ悪", "ほぼ解約", "解約"];
const STATUS_RANK: Record<string, number> = { 継続: 0, 保留: 1, Ｘジム: 2, パフォ悪: 3, ほぼ解約: 4, 解約: 5 };
const STATUS_CLS: Record<string, string> = {
  継続: "bg-emerald-50 text-emerald-700",
  保留: "bg-amber-50 text-amber-700",
  Ｘジム: "bg-teal-light text-teal-deep",
  パフォ悪: "bg-rose-50 text-rose-600",
  ほぼ解約: "bg-ink/5 text-ink/45",
  解約: "bg-ink/5 text-ink/45",
};
const ACTIVE_SET = new Set(["継続", "保留", "Ｘジム", "パフォ悪"]);

interface Talent {
  id: string; name: string; employment_type: string; skills: string | null;
  current_assignment: string | null; joined_on: string | null; left_on: string | null; notes: string | null;
  user_id: string | null;
  title: string | null; department: string | null; role_text: string | null; layer: string | null;
  contract_status: string; email: string | null; mail_system: string | null;
  hourly_rate: number | null; cost_managed: boolean;
}
interface Review {
  id: string; talent_id: string; period: string; reviewer: string | null;
  overall: number | null; comment: string | null; goals: string | null;
}

function stars(n: number | null): string {
  return n == null ? "—" : "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}
const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

/** BO-5 タレント台帳・稼働中評価: アクティブ人材(社員/業務委託/講師/企業)の台帳・契約状態・原価管理対象の管理。 */
export default async function TalentsPage() {
  await requireHrCtx();
  const sb = getSupabaseServer();
  const [talR, revR, members] = await Promise.all([
    sb.from("talents").select("id, name, employment_type, skills, current_assignment, joined_on, left_on, notes, user_id, title, department, role_text, layer, contract_status, email, mail_system, hourly_rate, cost_managed").order("created_at", { ascending: true }).limit(300),
    sb.from("talent_reviews").select("id, talent_id, period, reviewer, overall, comment, goals").order("created_at", { ascending: false }).limit(1000),
    getMembersLite(),
  ]);
  if (talR.error) throw new Error(`タレント台帳の取得に失敗: ${talR.error.message}`);
  const talents = (talR.data ?? []) as Talent[];
  const reviews = (revR.data ?? []) as Review[];
  const revByTalent = new Map<string, Review[]>();
  for (const r of reviews) {
    (revByTalent.get(r.talent_id) ?? revByTalent.set(r.talent_id, []).get(r.talent_id)!).push(r);
  }
  // 継続系を上に、同ステータス内は部署→名前
  const sorted = [...talents].sort((a, b) => {
    const d = (STATUS_RANK[a.contract_status] ?? 9) - (STATUS_RANK[b.contract_status] ?? 9);
    if (d !== 0) return d;
    return (a.department ?? "").localeCompare(b.department ?? "", "ja") || a.name.localeCompare(b.name, "ja");
  });
  const active = talents.filter((t) => ACTIVE_SET.has(t.contract_status) && !t.left_on);
  const churned = talents.filter((t) => !ACTIVE_SET.has(t.contract_status) || !!t.left_on);
  const costManaged = active.filter((t) => t.cost_managed);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="タレント台帳・評価"
        subtitle="アクティブ人材（社員・業務委託・講師・企業）の台帳です。契約ステータス・時給・原価管理対象フラグを管理し、期ごとの稼働中評価を記録します。"
      />

      <div className="grid grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">アクティブ</div><div className="stat-value mt-1">{active.length}</div></Card>
        <Card><div className="text-xs text-ink/50">原価管理対象</div><div className="stat-value mt-1">{costManaged.length}<span className="stat-unit">/ {active.length}</span></div></Card>
        <Card><div className="text-xs text-ink/50">解約・終了</div><div className="stat-value mt-1">{churned.length}</div></Card>
        <Card><div className="text-xs text-ink/50">評価記録</div><div className="stat-value mt-1">{reviews.length}</div></Card>
      </div>

      <Section title="タレントを追加" className="mb-5">
        <form action={createTalentAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">氏名 *</label><input name="name" required className="input" /></div>
          <div>
            <label className="label">区分</label>
            <select name="employment_type" className="input w-auto" defaultValue="contractor">
              {Object.entries(EMP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="label">部署</label><input name="department" className="input w-28" placeholder="営業/開発/講師" /></div>
          <div><label className="label">役割</label><input name="role_text" className="input" placeholder="例: 営業、コンサル" /></div>
          <div><label className="label">時給(円)</label><input name="hourly_rate" inputMode="numeric" className="input w-24 text-right" placeholder="5000" /></div>
          <div><label className="label">メール</label><input name="email" type="email" className="input" /></div>
          <div><label className="label">稼働開始日</label><input name="joined_on" type="date" className="input w-auto" /></div>
          <button type="submit" className="btn-accent">追加</button>
        </form>
        <p className="text-xs text-ink/40 mt-2">※ 候補者ページで「入社・稼働」にすると自動でここに追加されます</p>
      </Section>

      <Section title={`台帳（${talents.length}）`}>
        {sorted.length === 0 ? (
          <p className="text-sm text-ink/40 py-6 text-center">タレントがまだいません</p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((t) => {
              const revs = revByTalent.get(t.id) ?? [];
              const latest = revs[0];
              const inactive = !ACTIVE_SET.has(t.contract_status) || !!t.left_on;
              const statusCls = STATUS_CLS[t.contract_status] ?? "bg-mist-soft text-ink/55";
              const statusOpts = STATUS_OPTIONS.includes(t.contract_status) ? STATUS_OPTIONS : [t.contract_status, ...STATUS_OPTIONS];
              return (
                <li key={t.id} className={`rounded-xl border border-black/[0.05] p-3 ${inactive ? "opacity-55" : ""}`}>
                  <form action={updateTalentAction} className="space-y-2">
                    <input type="hidden" name="id" value={t.id} />
                    <div className="flex items-center gap-2.5 flex-wrap text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span className={`pill ${statusCls} text-[10px] font-bold`}>{t.contract_status}</span>
                      {!t.cost_managed && <span className="pill bg-violet-50 text-violet-700 text-[10px]" title="成功報酬など、原価管理の対象外">原価管理対象外</span>}
                      {t.title && <span className="text-xs text-ink/50">{t.title}</span>}
                      {t.layer && <span className="pill bg-black/[0.04] text-ink/55 text-[10px]">{t.layer}</span>}
                      {t.hourly_rate != null && <span className="text-xs text-ink/60 tabular-nums">{yen(Number(t.hourly_rate))}/時</span>}
                      {t.joined_on && <span className="text-xs text-ink/40 tabular-nums">{t.joined_on}〜{t.left_on ?? ""}</span>}
                      {latest && <span className="text-xs text-amber-600" title={`${latest.period} の総合評価`}>{stars(latest.overall)}</span>}
                      <span className="ml-auto" />
                      <button type="submit" className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]">保存</button>
                      {!t.left_on && <button name="op" value="leave" className="text-xs text-ink/45 hover:underline">退職・終了</button>}
                      <button name="op" value="delete" className="text-xs text-rose-500 hover:underline">削除</button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select name="employment_type" defaultValue={t.employment_type} className="input w-auto text-xs py-1.5" title="区分">
                        {Object.entries(EMP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select name="contract_status" defaultValue={t.contract_status} className="input w-auto text-xs py-1.5" title="契約ステータス">
                        {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input name="department" defaultValue={t.department ?? ""} className="input w-24 text-xs py-1.5" placeholder="部署" title="部署" />
                      <input name="title" defaultValue={t.title ?? ""} className="input flex-1 min-w-[150px] text-xs py-1.5" placeholder="役職" title="役職" />
                      <input name="layer" defaultValue={t.layer ?? ""} className="input w-24 text-xs py-1.5" placeholder="レイヤー" title="レイヤー(FS/IS/所属先など)" />
                      <input name="hourly_rate" defaultValue={t.hourly_rate != null ? String(Number(t.hourly_rate)) : ""} inputMode="numeric" className="input w-20 text-xs py-1.5 text-right" placeholder="時給" title="時給(円)" />
                      <label className="inline-flex items-center gap-1.5 text-xs text-ink/70 whitespace-nowrap px-1" title="成功報酬など特殊な報酬体系の場合はOFF">
                        <input type="checkbox" name="cost_managed" defaultChecked={t.cost_managed} className="accent-teal-600" /> 原価管理対象
                      </label>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input name="role_text" defaultValue={t.role_text ?? ""} className="input flex-1 min-w-[170px] text-xs py-1.5" placeholder="役割（営業、コンサル、講師 等）" title="役割" />
                      <input name="email" defaultValue={t.email ?? ""} className="input flex-1 min-w-[180px] text-xs py-1.5" placeholder="連絡先メール" title="連絡先メール" />
                      <select name="mail_system" defaultValue={t.mail_system ?? ""} className="input w-auto text-xs py-1.5" title="メール種別">
                        <option value="">メール種別</option>
                        <option value="GWS">GWS</option>
                        <option value="Zoho">Zoho</option>
                      </select>
                      <input name="notes" defaultValue={t.notes ?? ""} className="input flex-1 min-w-[150px] text-xs py-1.5" placeholder="メモ" />
                      <select
                        name="user_id"
                        defaultValue={t.user_id ?? ""}
                        className="input w-auto text-xs py-1.5"
                        title="CRMログインの紐付け。紐付けると本人が「稼働報告」で自分のアサインに実績を記入できます"
                      >
                        <option value="">CRMアカウント未紐付け</option>
                        {members.map((m) => (
                          <option key={m.user.id} value={m.user.id}>{m.user.name}（{m.user.email}）</option>
                        ))}
                      </select>
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
