import { notFound } from "next/navigation";
import { MoneyInput } from "@/components/ui/money-input";
import Link from "next/link";
import { ChevronLeft, FlaskConical, Trash2 } from "lucide-react";
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
import { DataPath, EditTarget, entityBorder } from "@/components/layout/data-path";
import { Tag } from "@/components/ui/badges";
import { OppMiniList } from "@/components/opportunities/opp-mini-list";
import { MeetingList } from "@/components/meetings/meeting-list";
import { SouvenirSection } from "@/components/accounts/souvenir-section";
import { AccountNotesSection } from "@/components/accounts/account-notes-section";
import { RecordRecent } from "@/components/layout/recent-items";
import { createOpportunityAction, createMeetingAction } from "@/server/actions";
import { deleteAccountAction } from "@/server/actions/trash";
import { ChangeHistory } from "@/components/history/change-history";
import { AttachmentSection } from "@/components/attachments/attachment-section";
import { DocumentSection } from "@/components/documents/document-section";
import { UnifiedTimeline, type TimelineEvent } from "@/components/history/unified-timeline";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { getSolutionPackages, getAccountSouvenirs } from "@/lib/data/souvenirs";
import { getCardsByAccount } from "@/lib/data/business-cards";
import { CardMiniList } from "@/components/business-cards/card-mini-list";
import { getTransitionsByAccount, TRANSITION_STATUS_LABEL, FOLLOWUP_STATUS_LABEL } from "@/lib/data/transitions";
import { STAGES, FORECAST_CATEGORIES, DEAL_PHASES } from "@/lib/constants";
import { formatYen, sum, formatDateFull } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";
import { AccountContactsPanel } from "@/components/contacts/account-contacts-panel";
import { leadCandidatesQuery, buildLeadCandidates, type LeadCandRow } from "@/lib/data/lead-candidates";

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
  const sb = getSupabaseServer();
  const oppIds = opps.map((o) => o.id);
  const orFilter = oppIds.length > 0
    ? `account_id.eq.${account.id},opportunity_id.in.(${oppIds.join(",")})`
    : `account_id.eq.${account.id}`;
  const [packages, souvenirs, transitions, businessCards, activitiesR, tasksR, leadCandR, labCompanyR] = await Promise.all([
    getSolutionPackages(),
    getAccountSouvenirs(account.id),
    getTransitionsByAccount(account.id),
    getCardsByAccount(account.id),
    sb.from("activities").select("id,activity_type,title,body,activity_at,owner_user_id").or(orFilter).order("activity_at", { ascending: false }).limit(60),
    sb.from("tasks").select("id,title,due_date,status,assigned_to").or(orFilter).order("due_date", { ascending: false }).limit(30),
    leadCandidatesQuery(sb, account.id, account.name),
    // AI体験環境(/lab)。RLSで owner/admin 以外は結果が空になるため、非管理者には表示されない。
    sb.from("ai_lab_companies").select("id, name, slug, is_active").eq("account_id", account.id).limit(1).maybeSingle(),
  ]);
  const labCompany = labCompanyR.data as { id: string; name: string; slug: string; is_active: boolean } | null;
  // 担当者：各担当者が窓口(アカウンター)になっている案件と、リード候補（名刺）を用意。
  const accounterByContact: Record<string, { id: string; name: string }[]> = {};
  for (const op of ws.opportunities.filter((x) => x.account_id === account.id)) {
    if (op.contact_id) (accounterByContact[op.contact_id] ??= []).push({ id: op.id, name: op.name });
  }
  const contactEmails = new Set(contacts.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean));
  const leadCandidates = buildLeadCandidates((leadCandR.data ?? []) as LeadCandRow[], contactEmails);

  // C-1 統合タイムライン: 活動・商談・タスク・案件の節目を時系列1本に
  const usersById = ws.usersById;
  const timeline: TimelineEvent[] = [
    ...((activitiesR.data ?? []) as { id: string; activity_type: string; title: string; body: string | null; activity_at: string; owner_user_id: string }[]).map(
      (a): TimelineEvent => ({
        id: a.id, at: a.activity_at, kind: "activity",
        label: ACTIVITY_TYPE_MAP[a.activity_type]?.label ?? a.activity_type,
        title: a.title, body: a.body, who: usersById.get(a.owner_user_id)?.name,
      }),
    ),
    ...meetings.map((m): TimelineEvent => ({
      id: m.id, at: m.meeting_at ?? m.meeting_date ?? m.created_at, kind: "meeting",
      label: "商談", title: m.title, body: m.summary,
      who: m.owner_user_id ? usersById.get(m.owner_user_id)?.name : undefined,
      href: `/app/opportunities/${m.opportunity_id}/meetings/${m.id}`,
    })),
    ...((tasksR.data ?? []) as { id: string; title: string; due_date: string; status: string; assigned_to: string }[]).map(
      (t): TimelineEvent => ({
        id: t.id, at: t.due_date, kind: "task",
        label: t.status === "done" ? "タスク完了" : "タスク",
        title: t.title, who: usersById.get(t.assigned_to)?.name,
      }),
    ),
    ...opps.map((o): TimelineEvent => ({
      id: o.id, at: o.created_at, kind: "milestone",
      label: "案件作成", title: o.name, href: `/app/opportunities/${o.id}`,
      who: usersById.get(o.owner_user_id ?? "")?.name,
    })),
    ...opps
      .filter((o) => o.status === "won" || o.status === "lost")
      .map((o): TimelineEvent => ({
        id: `${o.id}-close`, at: o.expected_close_date ?? o.updated_at, kind: "milestone",
        label: o.status === "won" ? "受注" : "失注",
        title: `${o.name}（${formatYen(o.amount)}）`, href: `/app/opportunities/${o.id}`,
      })),
  ];

  // 基本情報: この顧客の流入元・タイミングを案件詳細画面と同様に一目で把握できるようにする。
  // 顧客自体は流入経路を持たないため、最初に作られた案件(入口)から流入情報を引く。
  const oppsByCreated = [...opps].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const entryOpp = oppsByCreated[0];
  const distinctSources = Array.from(
    new Set(opps.map((o) => o.leadSource?.name).filter((n): n is string => !!n)),
  );
  const entryDetail = entryOpp?.source_detail || entryOpp?.campaign?.name || "";
  // 初回接点日: 案件の初回商談日、なければ商談実績の最古日付
  const firstMeetingDate =
    opps.map((o) => o.first_meeting_date).filter((d): d is string => !!d).sort()[0] ??
    meetings.map((m) => m.meeting_date).filter((d): d is string => !!d).sort()[0] ??
    null;
  // 最終商談日: 商談実績の最新日付
  const meetingDatesSorted = meetings.map((m) => m.meeting_date).filter((d): d is string => !!d).sort();
  const lastMeetingDate = meetingDatesSorted.length > 0 ? meetingDatesSorted[meetingDatesSorted.length - 1] : null;
  const accountOwner = ws.usersById.get(account.owner_user_id ?? "");

  return (
    <div>
      <RecordRecent href={`/app/accounts/${account.id}`} label={account.name} kind="顧客" />
      <Link href="/app/accounts" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 顧客一覧
      </Link>
      {/* データ階層: 顧客(いまここ)。配下の案件・商談は下のセクションに色分けで表示 */}
      <DataPath items={[{ level: "account", name: account.name, current: true }]} />
      {searchParams.error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{searchParams.error}</div>
      )}
      <PageHeader
        title={account.name}
        subtitle={`${account.industry ?? ""} ${account.area ? "・" + account.area : ""}`}
        action={
          <div className="flex items-center gap-2">
            {account.rank && (
              <Tag tone={account.rank === "A" ? "orange" : account.rank === "S" ? "orange" : account.rank === "B" ? "teal" : "gray"}>
                {account.rank}ランク
              </Tag>
            )}
            <Tag tone={account.status === "customer" ? "teal" : "gray"}>{statusLabel[account.status]}</Tag>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">案件数</div><div className="stat-value mt-1">{opps.length}</div></Card>
        <Card><div className="text-xs text-ink/50">進行中金額</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(sum(open, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">累計受注額(LTV)</div><div className="text-2xl font-bold mt-1 stat-accent tabular-nums">{formatYen(sum(won, (o) => o.amount))}</div></Card>
        <Card><div className="text-xs text-ink/50">担当者</div><div className="stat-value mt-1">{contacts.length}<span className="stat-unit">名</span></div></Card>
      </div>

      {/* AI研修で使う生成AI体験環境。紐付けがあるときだけ出す */}
      {labCompany && (
        <div className="card card-pad mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FlaskConical size={15} className="text-teal-primary" />
              <span className="text-sm font-semibold text-ink">AI体験環境</span>
              {!labCompany.is_active && <span className="pill bg-ink/10 text-ink/55">停止中</span>}
            </div>
            <p className="mt-0.5 text-xs text-ink/50">
              受講者用URL: <span className="font-mono">/lab/{labCompany.slug}</span>
            </p>
          </div>
          <Link href={`/app/ai-lab/${labCompany.id}`} className="btn-ghost text-sm">
            管理する
          </Link>
          <a href={`/lab/${labCompany.slug}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">
            体験環境を開く
          </a>
        </div>
      )}

      {/* 顧客メモ: 顧客とのやりとりまとめ・AI分析(満足度/業務課題解決度)・戦略提言を集約 */}
      <div className="mb-5">
        <AccountNotesSection accountId={account.id} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* 案件 */}
          <Section title={`案件（${opps.length}）`} className={entityBorder("opportunity")} action={<EditTarget level="opportunity" />}>
            <OppMiniList opps={opps} emptyMessage="案件はありません" showAccount={false} />
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
                    <MoneyInput name="amount" placeholder="1,500,000" className="input" />
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
                <SubmitButton className="btn-accent" pendingLabel="登録中…">案件を登録</SubmitButton>
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
          <Section title={`商談（${meetings.length}回）`} className={entityBorder("meeting")} action={<EditTarget level="meeting" />}>
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
                  <SubmitButton className="btn-accent" pendingLabel="登録中…">商談を登録</SubmitButton>
                </form>
              </details>
            ) : (
              <p className="text-xs text-ink/40 mt-2">商談を登録するには、先に案件を作成してください。</p>
            )}
          </Section>

          <Section title="統合タイムライン" action={<span className="text-[11px] text-ink/40">この顧客と何があったかを時系列で</span>}>
            <UnifiedTimeline events={timeline} />
          </Section>
        </div>

        <div className="space-y-5">
          {/* 基本情報: 流入元・タイミング(案件詳細画面と同様に、この顧客の入口と時系列が一目で分かる) */}
          <Section title="基本情報">
            <dl className="space-y-2.5 text-sm">
              <Row label="流入経路">{distinctSources.length > 0 ? distinctSources.join("、") : "—"}</Row>
              <Row label="流入詳細（どの展示会・施策）">{entryDetail || "—"}</Row>
              <Row label="担当営業">{accountOwner?.name ?? "—"}</Row>
              <Row label="顧客登録日">{formatDateFull(account.created_at)}</Row>
              <Row label="初回商談日">{formatDateFull(firstMeetingDate)}</Row>
              <Row label="最終商談日">{formatDateFull(lastMeetingDate)}</Row>
            </dl>
          </Section>

          <Section title="担当者" action={<span className="text-[11px] text-ink/40">窓口担当者の確認・追加・編集。各担当がどの案件の窓口かも表示</span>}>
            <AccountContactsPanel
              accountId={account.id}
              contacts={contacts}
              accounterByContact={accounterByContact}
              leadCandidates={leadCandidates}
            />
          </Section>

          <Section title={`名刺情報（${businessCards.length}）`} action={<Link href="/app/business-cards" className="text-[11px] text-teal-deep hover:underline">名刺一覧へ</Link>}>
            <CardMiniList cards={businessCards} usersById={usersById} />
          </Section>

          <DocumentSection targetType="account" targetId={account.id} revalidatePath={`/app/accounts/${account.id}`} />

          <AttachmentSection targetType="account" targetId={account.id} revalidatePath={`/app/accounts/${account.id}`} />

          <ChangeHistory table="accounts" recordId={account.id} />
        </div>
      </div>

      {/* 削除(控えめ・確認つき) */}
      <Card className="mt-8 border-l-4 border-l-rose-300">
        <details>
          <summary className="cursor-pointer text-sm text-ink/50">危険な操作（この顧客を削除）</summary>
          <form action={deleteAccountAction} className="mt-3 flex items-center gap-3 flex-wrap">
            <input type="hidden" name="id" value={account.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
              <Trash2 size={15} /> この顧客を削除する
            </button>
            <span className="text-xs text-ink/40">案件が紐づいている場合は削除できません。削除後30日間は「設定 → ゴミ箱」から復元できます。</span>
          </form>
        </details>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink/45 text-xs">{label}</dt>
      <dd className="text-ink/90 text-right">{children}</dd>
    </div>
  );
}
