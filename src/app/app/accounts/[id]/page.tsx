import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getWorkspaceForAccount } from "@/lib/data/workspace";
import {
  getAccount,
  getContactsByAccount,
  listOpportunities,
  getMeetingsByAccount,
  listMembers,
  getProducts,
  getLeadSources,
} from "@/lib/data/select";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/badges";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { MeetingList } from "@/components/meetings/meeting-list";
import { SouvenirSection } from "@/components/accounts/souvenir-section";
import { createOpportunityAction, createMeetingAction } from "@/server/actions";
import { getSolutionPackages, getAccountSouvenirs } from "@/lib/data/souvenirs";
import { getTransitionsByAccount, TRANSITION_STATUS_LABEL, FOLLOWUP_STATUS_LABEL } from "@/lib/data/transitions";
import { STAGES, FORECAST_CATEGORIES, DEAL_PHASES } from "@/lib/constants";
import { formatYen, sum } from "@/lib/utils";

const statusLabel: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };

export default async function AccountDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const ws = await getWorkspaceForAccount(params.id);
  const account = getAccount(ws, params.id);
  if (!account) notFound();

  const contacts = getContactsByAccount(ws, account.id);
  const opps = listOpportunities(ws).filter((o) => o.account_id === account.id);
  const meetings = getMeetingsByAccount(ws, account.id);
  const members = listMembers(ws).map(({ user }) => user);
  const products = getProducts(ws);
  const sources = getLeadSources(ws);
  const won = opps.filter((o) => o.status === "won");
  const open = opps.filter((o) => o.status === "open");
  const [packages, souvenirs, transitions] = await Promise.all([
    getSolutionPackages(),
    getAccountSouvenirs(account.id),
    getTransitionsByAccount(account.id),
  ]);

  return (
    <div>
      <Link href="/app/accounts" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 顧客一覧
      </Link>
      {searchParams.error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{searchParams.error}</div>
      )}
      <PageHeader
        title={account.name}
        subtitle={`${account.industry ?? ""} ${account.area ? "・" + account.area : ""}`}
        action={<Tag tone={account.status === "customer" ? "teal" : "gray"}>{statusLabel[account.status]}</Tag>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">案件数</div><div className="stat-value mt-1">{opps.length}</div></Card>
        <Card><div className="text-xs text-ink/50">進行中金額</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(sum(open, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">累計受注額(LTV)</div><div className="text-2xl font-bold mt-1 stat-accent tabular-nums">{formatYen(sum(won, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">担当者</div><div className="stat-value mt-1">{contacts.length}<span className="stat-unit">名</span></div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* 案件 */}
          <Section title={`案件（${opps.length}）`}>
            <OppMiniList opps={opps} emptyMessage="案件はありません" />
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 案件を登録</summary>
              <form action={createOpportunityAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="account_id" value={account.id} />
                <div>
                  <label className="label">案件名 *</label>
                  <input name="name" required className="input" placeholder="例：情報S向けAI研修 / 製品開発アイデアAI開発" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">担当営業</label>
                    <select name="owner_user_id" defaultValue={ws.ctx.userId} className="input">
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">主商材</label>
                    <select name="primary_product_id" className="input" defaultValue="">
                      <option value="">選択してください</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">ステージ</label>
                    <select name="stage" defaultValue="lead_acquired" className="input">
                      {STAGES.filter((s) => s.group === "open").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">ヨミ</label>
                    <select name="forecast_category" defaultValue="pipeline" className="input">
                      {FORECAST_CATEGORIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">見込み金額</label>
                    <input name="amount" type="number" className="input" placeholder="1500000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">案件予測 *</label>
                    <select name="deal_phase" required className="input" defaultValue="">
                      <option value="" disabled>選択してください</option>
                      {DEAL_PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">受注見込み時期 *</label>
                    <input name="expected_revenue_month" type="month" required className="input" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">次回アクション日 *</label>
                    <input name="next_action_date" type="date" required className="input" />
                  </div>
                  <div>
                    <label className="label">流入経路</label>
                    <select name="lead_source_id" className="input" defaultValue="">
                      <option value="">選択してください</option>
                      {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">次回アクション内容 *</label>
                  <input name="next_action_text" required className="input" placeholder="次に誰が何をするか（例：提案書を送付し来週アポ打診）" />
                </div>
                <button type="submit" className="btn-accent">案件を登録</button>
              </form>
            </details>
          </Section>

          {/* お土産提案（アップセル候補） */}
          <SouvenirSection accountId={account.id} souvenirs={souvenirs} packages={packages} />

          {/* 研修後トランジション状況 */}
          {transitions.length > 0 && (
            <Section title="研修後トランジション" action={<span className="text-[11px] text-ink/40">受注後のアップセル導線</span>}>
              <ul className="space-y-2">
                {transitions.map((t) => (
                  <li key={t.id} className="rounded-xl border border-black/[0.06] p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Link href={`/app/opportunities/${t.original_opportunity_id}`} className="text-teal-deep hover:underline text-xs">元案件を見る</Link>
                      <span className="pill bg-mist-soft text-ink/55 text-[10px]">{t.initial_product === "training" ? "研修" : t.initial_product === "development" ? "開発" : t.initial_product ?? "—"}</span>
                      <span className="pill bg-teal-light text-teal-deep text-[10px] ml-auto">{TRANSITION_STATUS_LABEL[t.status] ?? t.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/60">
                      <span>御礼(3営業日): <b>{FOLLOWUP_STATUS_LABEL[t.followup_3days_status]}</b></span>
                      <span>定着MTG(2週): <b>{FOLLOWUP_STATUS_LABEL[t.followup_2weeks_status]}</b></span>
                      <span>お土産提案(30日): <b>{FOLLOWUP_STATUS_LABEL[t.proposal_30days_status]}</b></span>
                    </div>
                    <p className="text-[11px] text-ink/40 mt-1.5">フォロータスクは案件のタスク一覧に自動生成されています。</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* 商談 */}
          <Section title={`商談（${meetings.length}回）`} action={<span className="text-xs text-ink/40">案件配下の個別商談</span>}>
            <MeetingList meetings={meetings} showOpportunity emptyMessage="商談はまだありません" />
            {opps.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 商談を登録</summary>
                <form action={createMeetingAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
                  <input type="hidden" name="account_id" value={account.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">案件 *</label>
                      <select name="opportunity_id" required className="input">
                        {opps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">商談日</label>
                      <input name="meeting_date" type="date" className="input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">タイトル *</label>
                      <input name="title" required className="input" placeholder="例：初回商談 / 2回目 提案" />
                    </div>
                    <div>
                      <label className="label">担当</label>
                      <select name="owner_user_id" defaultValue={ws.ctx.userId} className="input">
                        {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="label">議事・要点</label>
                    <textarea name="summary" rows={2} className="input" />
                  </div>
                  <button type="submit" className="btn-accent">商談を登録</button>
                </form>
              </details>
            ) : (
              <p className="text-xs text-ink/40 mt-2">商談を登録するには、先に案件を作成してください。</p>
            )}
          </Section>
        </div>

        <Section title="担当者">
          {contacts.length === 0 ? (
            <p className="text-sm text-ink/40 py-2">担当者がいません</p>
          ) : (
            <ul className="space-y-3">
              {contacts.map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="font-medium">{c.name} <span className="text-xs text-ink/50">{c.title}</span></div>
                  <div className="text-xs text-ink/50">{c.department} ・ {c.email}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
