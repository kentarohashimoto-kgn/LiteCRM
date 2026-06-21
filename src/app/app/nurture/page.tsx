import { getWorkspaceLite } from "@/lib/data/workspace";
import { listMembers } from "@/lib/data/select";
import { getNurtureExtras } from "@/lib/data/nurture";
import { saveAccountNurtureAction, addNurtureTouchAction } from "@/server/actions";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { NURTURE_STAGES, NURTURE_STAGE_LABEL, RELATIONSHIP_OPTS, RELATIONSHIP_LABEL, STALE_CONTACT_DAYS } from "@/lib/nurture";
import { formatYen, formatDateFull, daysSince } from "@/lib/utils";

export default async function NurturePage() {
  const ws = await getWorkspaceLite();
  const members = listMembers(ws).map(({ user }) => user);
  const { nurtureByAccount, touchesByAccount } = await getNurtureExtras();
  const today = new Date().toISOString().slice(0, 10);

  // 既存顧客 = 受注済み案件のある会社(+ 深耕レコードのある会社)
  const agg = new Map<string, { won: number; first: string | null; services: Set<string>; open: number }>();
  for (const o of ws.opportunities) {
    if (!o.account_id) continue;
    const g = agg.get(o.account_id) ?? { won: 0, first: null, services: new Set<string>(), open: 0 };
    if (o.status === "won") {
      g.won += o.amount ?? 0;
      const d = o.expected_close_date ?? o.expected_revenue_month ?? null;
      if (d && (!g.first || d < g.first)) g.first = d;
      const p = o.primary_product_id ? ws.productsById.get(o.primary_product_id)?.name : null;
      if (p) g.services.add(p);
    } else if (o.status === "open") g.open += o.amount ?? 0;
    agg.set(o.account_id, g);
  }
  const accountIds = new Set<string>([
    ...[...agg.keys()].filter((id) => (agg.get(id)?.won ?? 0) > 0),
    ...nurtureByAccount.keys(),
  ]);

  const rows = [...accountIds].map((id) => {
    const acc = ws.accountsById.get(id);
    const g = agg.get(id) ?? { won: 0, first: null, services: new Set<string>(), open: 0 };
    const n = nurtureByAccount.get(id);
    const touches = touchesByAccount.get(id) ?? [];
    const lastTouch = touches[0]?.touched_at ?? g.first ?? null;
    const stale = lastTouch ? (daysSince(lastTouch) ?? 0) : 999;
    const overdue = !!n?.next_contact_date && n.next_contact_date < today;
    const alerts: string[] = [];
    if (stale >= STALE_CONTACT_DAYS) alerts.push(`${STALE_CONTACT_DAYS}日以上接点なし`);
    if (overdue) alerts.push("次回接点日超過");
    return { id, name: acc?.name ?? "—", won: g.won, first: g.first, services: [...g.services], open: g.open, n, touches, stale, alerts };
  }).sort((a, b) => (b.alerts.length - a.alerts.length) || (b.won - a.won));

  const totalWon = rows.reduce((s, r) => s + r.won, 0);
  const totalAdd = rows.reduce((s, r) => s + (r.n?.this_year_additional ?? 0), 0);
  const dormant = rows.filter((r) => r.n?.relationship === "dormant" || r.n?.nurture_stage === "dormant").length;
  const needFollow = rows.filter((r) => r.alerts.length).length;

  return (
    <div>
      <PageHeader title="既存顧客深耕" subtitle="受注済み顧客を「受注して終わり」にせず、実施後フォロー→追加課題→アップセル→横展開まで継続管理します。" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">既存顧客</div><div className="text-2xl font-bold mt-1">{rows.length}</div></Card>
        <Card><div className="text-xs text-ink/50">累計受注額</div><div className="text-xl font-bold mt-1 tabular-nums">{formatYen(totalWon)}</div></Card>
        <Card><div className="text-xs text-ink/50">今年度追加見込み</div><div className="text-xl font-bold mt-1 stat-accent">{formatYen(totalAdd)}</div></Card>
        <Card><div className="text-xs text-ink/50">休眠</div><div className="text-2xl font-bold mt-1">{dormant}</div></Card>
        <Card><div className="text-xs text-ink/50">要フォロー</div><div className="text-2xl font-bold mt-1 text-rose-600">{needFollow}</div></Card>
      </div>

      <Section title={`深耕対象（${rows.length}社）`} action={<span className="text-xs text-ink/40">{STALE_CONTACT_DAYS}日以上接点なし・次回接点日超過を上部表示</span>}>
        <div className="space-y-2">
          {rows.map((r) => (
            <details key={r.id} className="card card-pad">
              <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="pill bg-teal-light text-teal-deep text-[10px]">{NURTURE_STAGE_LABEL[r.n?.nurture_stage ?? "just_won"]}</span>
                  <span className="font-medium truncate">{r.name}</span>
                  {r.n?.relationship && <span className="text-xs text-ink/45">関係: {RELATIONSHIP_LABEL[r.n.relationship]}</span>}
                </span>
                <span className="flex items-center gap-3 text-xs shrink-0 tabular-nums">
                  <span>累計 {formatYen(r.won)}</span>
                  {r.open > 0 && <span className="text-ink/50">進行 {formatYen(r.open)}</span>}
                  <span className="text-ink/40">最終接点 {r.stale >= 999 ? "—" : `${r.stale}日前`}</span>
                  {r.alerts.map((a) => <span key={a} className="pill bg-rose-50 text-rose-500 text-[10px]">{a}</span>)}
                </span>
              </summary>

              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-black/[0.05] pt-3">
                {/* 深耕情報 */}
                <form action={saveAccountNurtureAction} className="space-y-2">
                  <input type="hidden" name="account_id" value={r.id} />
                  <div className="text-xs font-semibold text-ink/60">深耕情報（実施済み: {r.services.join("・") || "—"}／初回受注 {formatDateFull(r.first)}）</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="label">深耕ステージ</label><select name="nurture_stage" defaultValue={r.n?.nurture_stage ?? "just_won"} className="input text-sm">{NURTURE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
                    <div><label className="label">関係性</label><select name="relationship" defaultValue={r.n?.relationship ?? ""} className="input text-sm"><option value="">—</option>{RELATIONSHIP_OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
                    <div><label className="label">深耕担当</label><select name="deep_owner_user_id" defaultValue={r.n?.deep_owner_user_id ?? ""} className="input text-sm"><option value="">—</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                    <div><label className="label">次回接点日</label><input name="next_contact_date" type="date" defaultValue={r.n?.next_contact_date ?? ""} className="input text-sm" /></div>
                    <div><label className="label">今年度追加見込み(円)</label><input name="this_year_additional" type="number" defaultValue={r.n?.this_year_additional ?? ""} className="input text-sm" /></div>
                    <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" name="exec_contact" value="1" defaultChecked={r.n?.exec_contact} className="accent-teal-primary" /> 経営層接点あり</label>
                  </div>
                  <input name="additional_proposal" defaultValue={r.n?.additional_proposal ?? ""} placeholder="追加提案候補(追加研修/AI顧問/開発/他部門展開)" className="input text-sm" />
                  <input name="expansion_depts" defaultValue={r.n?.expansion_depts ?? ""} placeholder="横展開可能部門(人事/営業/経理/情シス)" className="input text-sm" />
                  <input name="next_proposal" defaultValue={r.n?.next_proposal ?? ""} placeholder="次回提案予定" className="input text-sm" />
                  <input name="services_done" defaultValue={r.n?.services_done ?? ""} placeholder="実施済みサービス(補足)" className="input text-sm" />
                  <button type="submit" className="btn-accent text-sm">深耕情報を保存</button>
                </form>

                {/* 接点履歴 */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-ink/60">接点履歴</div>
                  <ul className="space-y-1 max-h-32 overflow-y-auto">
                    {r.touches.slice(0, 6).map((t) => (
                      <li key={t.id} className="text-xs text-ink/70 border-l-2 border-teal-light pl-2">
                        <span className="text-ink/40">{formatDateFull(t.touched_at)}</span> {t.method && `[${t.method}]`} {t.summary}{t.reaction ? `（反応: ${t.reaction}）` : ""}
                      </li>
                    ))}
                    {r.touches.length === 0 && <li className="text-xs text-ink/35">履歴なし</li>}
                  </ul>
                  <form action={addNurtureTouchAction} className="grid grid-cols-2 gap-2 border-t border-black/[0.05] pt-2">
                    <input type="hidden" name="account_id" value={r.id} />
                    <input name="touched_at" type="date" className="input text-sm" />
                    <select name="method" className="input text-sm"><option value="">手段</option><option>訪問</option><option>オンライン</option><option>電話</option><option>メール</option></select>
                    <input name="summary" placeholder="接点内容" className="input text-sm col-span-2" />
                    <input name="reaction" placeholder="顧客反応" className="input text-sm" />
                    <input name="next_date" type="date" className="input text-sm" title="次回接点予定" />
                    <button type="submit" className="btn-ghost text-sm col-span-2">接点を記録</button>
                  </form>
                </div>
              </div>
            </details>
          ))}
          {rows.length === 0 && <p className="text-sm text-ink/40 py-6 text-center">受注済みの既存顧客がまだありません。</p>}
        </div>
      </Section>
      <p className="text-xs text-ink/40 mt-3">※ 既存顧客は既存案件(受注済)から自動抽出。累計受注額・初回受注日・実施済みサービスは案件から集計し、深耕ステージ・関係性・追加提案などを管理します。</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
