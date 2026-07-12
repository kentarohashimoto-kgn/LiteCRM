import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { getSrankDetail } from "@/lib/data/srank";
import { updateSrankAccountAction, saveSrankDeptAction, deleteSrankDeptAction, saveSrankKeypersonAction, deleteSrankKeypersonAction } from "@/server/actions";
import { PageHeader, Section } from "@/components/ui/primitives";
import { SRANK_STAGES, DEAL_STATUS, PROPOSAL_STATUS, PROPOSAL_STATUS_LABEL, KEYPERSON_ROLES, KEYPERSON_ROLE_LABEL, LEVEL3, RELATIONSHIP, TOPDOWN_MENU, BOTTOMUP_MENU } from "@/lib/srank";
import { formatYen, formatDateFull } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function SrankDetailPage({ params }: { params: { id: string } }) {
  const { account: a, departments, keypersons } = await getSrankDetail(params.id);
  if (!a) notFound();
  const deptTotal = departments.reduce((s, d) => s + (d.amount ?? 0), 0);

  return (
    <div>
      <Link href="/app/srank" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3"><ChevronLeft size={16} /> Sランク一覧</Link>
      <PageHeader title={a.company_name} subtitle={`攻略ステージ ${a.stage}｜今年度目標 ${formatYen(a.target_sales ?? 0)}｜部署別見込み計 ${formatYen(deptTotal)}`} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* 部署別攻略 */}
          <Section title={`部署別攻略（${departments.length}）`} action={<span className="text-xs text-ink/40">1社で複数部署を横展開</span>}>
            <div className="space-y-2">
              {departments.map((d) => (
                <details key={d.id} className="card card-pad">
                  <summary className="cursor-pointer flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium">{d.name}<span className="text-xs text-ink/45 ml-2">{d.keyperson || ""}</span></span>
                    <span className="flex items-center gap-2 text-xs"><span className="pill bg-mist-soft text-ink/60">{PROPOSAL_STATUS_LABEL[d.proposal_status] ?? d.proposal_status}</span><span className="tabular-nums">{formatYen(d.amount)}</span>{d.next_action_date && <span className="text-ink/40">{formatDateFull(d.next_action_date)}</span>}</span>
                  </summary>
                  <form action={saveSrankDeptAction} className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 border-t border-black/[0.05] pt-3">
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="srank_account_id" value={a.id} />
                    <div><label className="label">部署名</label><input name="name" defaultValue={d.name} className="input text-sm" /></div>
                    <div><label className="label">キーマン</label><input name="keyperson" defaultValue={d.keyperson ?? ""} className="input text-sm" /></div>
                    <div><label className="label">決裁者</label><input name="decision_maker" defaultValue={d.decision_maker ?? ""} className="input text-sm" /></div>
                    <div className="md:col-span-3"><label className="label">現場課題</label><input name="issue" defaultValue={d.issue ?? ""} className="input text-sm" /></div>
                    <div><label className="label">関心商材</label><input name="interest_products" defaultValue={d.interest_products ?? ""} className="input text-sm" placeholder={BOTTOMUP_MENU[0]} /></div>
                    <div><label className="label">予算</label><input name="budget_status" defaultValue={d.budget_status ?? ""} className="input text-sm" /></div>
                    <div><label className="label">導入時期</label><input name="timing" defaultValue={d.timing ?? ""} className="input text-sm" /></div>
                    <div><label className="label">提案状況</label><select name="proposal_status" defaultValue={d.proposal_status} className="input text-sm">{PROPOSAL_STATUS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
                    <div><label className="label">想定金額</label><input name="amount" type="number" defaultValue={d.amount} className="input text-sm" /></div>
                    <div><label className="label">横展開可能性</label><select name="expansion_potential" defaultValue={d.expansion_potential ?? ""} className="input text-sm"><option value="">—</option>{LEVEL3.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></div>
                    <div className="md:col-span-2"><label className="label">次アクション</label><input name="next_action" defaultValue={d.next_action ?? ""} className="input text-sm" /></div>
                    <div><label className="label">次アクション日</label><input name="next_action_date" type="date" defaultValue={d.next_action_date ?? ""} className="input text-sm" /></div>
                    <div className="md:col-span-3 flex items-center gap-2"><SubmitButton className="btn-accent text-sm" pendingLabel="保存中…">保存</SubmitButton></div>
                  </form>
                  <form action={deleteSrankDeptAction} className="mt-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="srank_account_id" value={a.id} /><button className="text-xs text-rose-400 hover:text-rose-600 inline-flex items-center gap-1"><Trash2 size={12} />削除</button></form>
                </details>
              ))}
              <details className="card card-pad">
                <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 部署を追加</summary>
                <form action={saveSrankDeptAction} className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <input type="hidden" name="srank_account_id" value={a.id} />
                  <input name="name" placeholder="部署名(人事/DX/情シス/営業 等)" className="input text-sm" required />
                  <input name="keyperson" placeholder="キーマン" className="input text-sm" />
                  <input name="decision_maker" placeholder="決裁者" className="input text-sm" />
                  <input name="issue" placeholder="現場課題" className="input text-sm md:col-span-3" />
                  <select name="proposal_status" defaultValue="none" className="input text-sm">{PROPOSAL_STATUS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
                  <input name="amount" type="number" placeholder="想定金額" className="input text-sm" />
                  <input name="next_action_date" type="date" className="input text-sm" />
                  <SubmitButton className="btn-primary text-sm md:col-span-3" pendingLabel="保存中…">部署を追加</SubmitButton>
                </form>
              </details>
            </div>
          </Section>

          {/* キーマン */}
          <Section title={`キーマン（${keypersons.length}）`} action={<span className="text-xs text-ink/40">決裁者・推進者・紹介者を複数把握</span>}>
            <div className="space-y-2">
              {keypersons.map((k) => (
                <details key={k.id} className="card card-pad">
                  <summary className="cursor-pointer flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium">{k.name}<span className="text-xs text-ink/45 ml-2">{k.department} {k.title}</span></span>
                    <span className="flex items-center gap-2 text-xs">{k.role && <span className="pill bg-teal-light text-teal-deep">{KEYPERSON_ROLE_LABEL[k.role] ?? k.role}</span>}<span className="text-ink/50">影響{k.influence ?? "—"}/関係{k.relationship ?? "—"}</span></span>
                  </summary>
                  <form action={saveSrankKeypersonAction} className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 border-t border-black/[0.05] pt-3">
                    <input type="hidden" name="id" value={k.id} /><input type="hidden" name="srank_account_id" value={a.id} />
                    <div><label className="label">氏名</label><input name="name" defaultValue={k.name} className="input text-sm" /></div>
                    <div><label className="label">部署</label><input name="department" defaultValue={k.department ?? ""} className="input text-sm" /></div>
                    <div><label className="label">役職</label><input name="title" defaultValue={k.title ?? ""} className="input text-sm" /></div>
                    <div><label className="label">役割</label><select name="role" defaultValue={k.role ?? ""} className="input text-sm"><option value="">—</option>{KEYPERSON_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
                    <div><label className="label">影響力</label><select name="influence" defaultValue={k.influence ?? ""} className="input text-sm"><option value="">—</option>{LEVEL3.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></div>
                    <div><label className="label">関係性</label><select name="relationship" defaultValue={k.relationship ?? ""} className="input text-sm"><option value="">—</option>{RELATIONSHIP.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></div>
                    <div><label className="label">次回接触日</label><input name="next_contact_date" type="date" defaultValue={k.next_contact_date ?? ""} className="input text-sm" /></div>
                    <div className="md:col-span-2"><label className="label">紹介可能部署</label><input name="intro_depts" defaultValue={k.intro_depts ?? ""} className="input text-sm" /></div>
                    <div className="md:col-span-2"><label className="label">次に依頼したいこと</label><input name="next_request" defaultValue={k.next_request ?? ""} className="input text-sm" placeholder="上司紹介/他部署紹介/追加課題共有 等" /></div>
                    <div><label className="label">懸念点</label><input name="concern" defaultValue={k.concern ?? ""} className="input text-sm" /></div>
                    <div className="md:col-span-3"><SubmitButton className="btn-accent text-sm" pendingLabel="保存中…">保存</SubmitButton></div>
                  </form>
                  <form action={deleteSrankKeypersonAction} className="mt-1"><input type="hidden" name="id" value={k.id} /><input type="hidden" name="srank_account_id" value={a.id} /><button className="text-xs text-rose-400 hover:text-rose-600 inline-flex items-center gap-1"><Trash2 size={12} />削除</button></form>
                </details>
              ))}
              <details className="card card-pad">
                <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ キーマンを追加</summary>
                <form action={saveSrankKeypersonAction} className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <input type="hidden" name="srank_account_id" value={a.id} />
                  <input name="name" placeholder="氏名" className="input text-sm" required />
                  <input name="department" placeholder="部署" className="input text-sm" />
                  <input name="title" placeholder="役職" className="input text-sm" />
                  <select name="role" defaultValue="" className="input text-sm"><option value="">役割</option>{KEYPERSON_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
                  <select name="influence" defaultValue="" className="input text-sm"><option value="">影響力</option>{LEVEL3.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
                  <select name="relationship" defaultValue="" className="input text-sm"><option value="">関係性</option>{RELATIONSHIP.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
                  <SubmitButton className="btn-primary text-sm md:col-span-3" pendingLabel="保存中…">キーマンを追加</SubmitButton>
                </form>
              </details>
            </div>
          </Section>
        </div>

        {/* 会社攻略情報 */}
        <div className="space-y-5">
          <Section title="会社攻略情報">
            <form action={updateSrankAccountAction} className="space-y-2.5">
              <input type="hidden" name="id" value={a.id} />
              <div><label className="label">攻略ステージ</label><select name="stage" defaultValue={a.stage} className="input text-sm">{SRANK_STAGES.map((s) => <option key={s.key} value={s.key}>{s.key} {s.label}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">今年度目標</label><input name="target_sales" type="number" defaultValue={a.target_sales ?? ""} className="input text-sm" /></div>
                <div><label className="label">中長期目標</label><input name="longterm_target" type="number" defaultValue={a.longterm_target ?? ""} className="input text-sm" /></div>
              </div>
              <div><label className="label">年間売上ポテンシャル</label><input name="revenue_potential" type="number" defaultValue={a.revenue_potential ?? ""} className="input text-sm" /></div>
              <div><label className="label">取引状況</label><select name="deal_status" defaultValue={a.deal_status} className="input text-sm">{DEAL_STATUS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
              <div><label className="label">Sランク指定理由</label><input name="srank_reason" defaultValue={a.srank_reason ?? ""} className="input text-sm" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exec_involved" value="1" defaultChecked={a.exec_involved} className="accent-teal-primary" /> 代表関与が必要</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="manager_involved" value="1" defaultChecked={a.manager_involved} className="accent-teal-primary" /> 営業推進(酒井さん)関与</label>
              <div className="border-t border-black/[0.05] pt-2 text-xs font-semibold text-ink/60">トップダウン攻略</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exec_contact" value="1" defaultChecked={a.exec_contact} className="accent-teal-primary" /> 経営層接点あり</label>
              <div><label className="label">経営層接点人物</label><input name="exec_contact_person" defaultValue={a.exec_contact_person ?? ""} className="input text-sm" /></div>
              <div><label className="label">接点ルート</label><input name="exec_contact_route" defaultValue={a.exec_contact_route ?? ""} className="input text-sm" placeholder="紹介/既存担当経由/イベント/代表接点" /></div>
              <div><label className="label">経営テーマ</label><input name="exec_theme" defaultValue={a.exec_theme ?? ""} className="input text-sm" placeholder="生産性向上/AI推進/人材育成/DX" /></div>
              <div><label className="label">全社課題</label><input name="company_issue" defaultValue={a.company_issue ?? ""} className="input text-sm" /></div>
              <div><label className="label">次に会うべき上位者</label><input name="next_upper_person" defaultValue={a.next_upper_person ?? ""} className="input text-sm" /></div>
              <div><label className="label">上位者紹介依頼状況</label><input name="intro_request_status" defaultValue={a.intro_request_status ?? ""} className="input text-sm" placeholder="未依頼/依頼済/紹介済/不可" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">次回経営層接点</label><input name="next_exec_contact_date" type="date" defaultValue={a.next_exec_contact_date ?? ""} className="input text-sm" /></div>
                <div><label className="label">次回部門接点</label><input name="next_dept_contact_date" type="date" defaultValue={a.next_dept_contact_date ?? ""} className="input text-sm" /></div>
              </div>
              <div><label className="label">重点攻略月</label><input name="priority_month" defaultValue={a.priority_month ?? ""} className="input text-sm" /></div>
              <SubmitButton className="btn-primary text-sm w-full" pendingLabel="保存中…">会社攻略情報を保存</SubmitButton>
            </form>
          </Section>
          <Section title="トップダウン提案メニュー候補">
            <ul className="text-xs text-ink/60 space-y-1 list-disc pl-4">{TOPDOWN_MENU.map((m) => <li key={m}>{m}</li>)}</ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
