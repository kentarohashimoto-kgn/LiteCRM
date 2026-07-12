import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Sparkles, Trash2, FolderKanban } from "lucide-react";
import { getWorkspaceForOpportunity } from "@/lib/data/workspace";
import {
  getActivitiesByOpportunity,
  getContactsByAccount,
  getOpportunity,
  getStageHistory,
  getTasksByOpportunity,
  getMeetingsByOpportunity,
  getBillingByOpportunity,
  getUser,
  listMembers,
  listCampaigns,
  getProducts,
  getLeadSources,
} from "@/lib/data/select";
import { MeetingList } from "@/components/meetings/meeting-list";
import { BillingSection } from "@/components/billing/billing-section";
import { SubscriptionForm } from "@/components/billing/subscription-form";
import { ScheduleSection } from "@/components/opportunities/schedule-section";
import { RecordRecent } from "@/components/layout/recent-items";
import { getLatestSchedule, getSalesTemplates, matchTemplates } from "@/lib/data/schedules";
import { CATEGORIES, CATEGORY_MAP, STAGE_MAP, ACTIVITY_TYPES, ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { Card, PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { ForecastBadge, StageBadge, StatusBadge, YomiBadge } from "@/components/ui/badges";
import { evaluateRisk, RISK_LABELS } from "@/lib/risk";
import { addActivityAction, updateOpportunityAction, setOpportunityCampaignAction, createMeetingAction, saveOppResearchAction, updateOpportunityBasicsAction, updateOppMemoAction } from "@/server/actions";
import { MeetingTaskInputs } from "@/components/opportunities/meeting-task-inputs";
import { YOMI_OPTIONS, canReassignOwner, canManageProjects } from "@/lib/constants";
import { deleteOpportunityAction } from "@/server/actions/trash";
import { ChangeHistory } from "@/components/history/change-history";
import { AttachmentSection } from "@/components/attachments/attachment-section";
import { ProposalSection } from "@/components/opportunities/proposal-section";
import { SubmitButton } from "@/components/ui/submit-button";
import { SourceSelect, type SourceDetailOption } from "@/components/opportunities/source-select";
import { DataPath, EditTarget, entityBorder } from "@/components/layout/data-path";
import { OpportunityActivityList } from "@/components/activities/opportunity-activity-list";
import { UnifiedTimeline, type TimelineEvent } from "@/components/history/unified-timeline";
import { CommentThread, type CommentView } from "@/components/opportunities/comment-thread";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LOST_REASONS } from "@/lib/constants";
import { formatYen, formatPercent, formatDateFull, formatMonth, daysSince, toJstDate } from "@/lib/utils";

const SAVED_MSG: Record<string, string> = { "1": "保存しました", activity: "活動を記録しました", memo: "現状メモ・ヨミを更新しました" };

export default async function OpportunityDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string } }) {
  const ws = await getWorkspaceForOpportunity(params.id);
  const o = getOpportunity(ws, params.id);
  if (!o) notFound();

  const activities = getActivitiesByOpportunity(ws, o.id);
  const meetings = getMeetingsByOpportunity(ws, o.id);
  const billing = getBillingByOpportunity(ws, o.id);
  const members = listMembers(ws).map(({ user }) => user);
  const canReassign = canReassignOwner(ws.ctx.role);
  const tasks = getTasksByOpportunity(ws, o.id);
  const history = getStageHistory(ws, o.id);
  const contacts = o.account ? getContactsByAccount(ws, o.account.id) : [];
  const campaigns = listCampaigns(ws);
  const products = getProducts(ws);
  const leadSources = getLeadSources(ws);
  const risk = evaluateRisk(o);
  const since = daysSince(o.last_activity_at);
  const todayInput = toJstDate(new Date().toISOString()) ?? "";
  const sb = getSupabaseServer();
  const [schedule, allTemplates, commentsR, detailsR] = await Promise.all([
    getLatestSchedule(o.id),
    getSalesTemplates(),
    sb.from("opportunity_comments").select("id, author_user_id, body, mentions, created_at").eq("opportunity_id", o.id).order("created_at", { ascending: true }).limit(100),
    sb.from("lead_source_details").select("id, lead_source_id, name").eq("status", "active").order("sort_order").order("name"),
  ]);
  const sourceDetails = (detailsR.data ?? []) as SourceDetailOption[];
  const templates = matchTemplates(allTemplates, o.account?.industry, contacts.map((c) => c.title));
  const comments: CommentView[] = ((commentsR.data ?? []) as { id: string; author_user_id: string; body: string; mentions: string[]; created_at: string }[]).map((c) => ({
    ...c,
    mentions: c.mentions ?? [],
    authorName: getUser(ws, c.author_user_id)?.name ?? "—",
  }));

  // C-1 統合タイムライン: 活動・商談・タスク・ステージ変更・コメントを時系列1本に
  const timeline: TimelineEvent[] = [
    ...activities.map((a): TimelineEvent => ({
      id: a.id, at: a.activity_at, kind: "activity",
      label: ACTIVITY_TYPE_MAP[a.activity_type]?.label ?? a.activity_type,
      title: a.title, body: a.body, who: getUser(ws, a.owner_user_id)?.name,
    })),
    ...meetings.map((m): TimelineEvent => ({
      id: m.id, at: m.meeting_at ?? m.meeting_date ?? m.created_at, kind: "meeting",
      label: "商談", title: m.title, body: m.summary,
      who: m.owner_user_id ? getUser(ws, m.owner_user_id)?.name : undefined,
      href: `/app/opportunities/${o.id}/meetings/${m.id}`,
    })),
    ...tasks.map((t): TimelineEvent => ({
      id: t.id, at: t.due_date, kind: "task",
      label: t.status === "done" ? "タスク完了" : "タスク",
      title: t.title, who: getUser(ws, t.assigned_to)?.name,
    })),
    ...history.map((h): TimelineEvent => ({
      id: h.id, at: h.changed_at, kind: "stage",
      label: "ステージ",
      title: `${h.from_stage ? (STAGE_MAP[h.from_stage]?.label ?? h.from_stage) + " → " : ""}${STAGE_MAP[h.to_stage]?.label ?? h.to_stage}`,
      body: h.reason, who: h.changed_by ? getUser(ws, h.changed_by)?.name : undefined,
    })),
    ...comments.map((c): TimelineEvent => ({
      id: c.id, at: c.created_at, kind: "comment",
      label: "コメント", title: c.body.length > 60 ? c.body.slice(0, 60) + "…" : c.body, who: c.authorName,
    })),
  ];

  return (
    <div>
      <RecordRecent href={`/app/opportunities/${o.id}`} label={`${o.account?.name ?? ""} ${o.name}`.trim()} kind="案件" />
      <Link href="/app/opportunities" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 案件一覧
      </Link>
      {/* データ階層: いまどのデータを開いているか */}
      <DataPath
        items={[
          ...(o.lead_id ? [{ level: "lead" as const, href: `/app/leads/${o.lead_id}` }] : []),
          ...(o.account ? [{ level: "account" as const, name: o.account.name, href: `/app/accounts/${o.account.id}` }] : []),
          { level: "opportunity", name: o.name, current: true },
        ]}
      />
      <PageHeader
        title={o.account?.name ?? "案件"}
        subtitle={o.name}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={o.status} />
            <StageBadge stage={o.stage} />
            <ForecastBadge category={o.forecast_category} />
            {canManageProjects(ws.ctx.role) && (
              <Link
                href={`/app/projects/${o.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
              >
                <FolderKanban size={14} /> 案件管理
              </Link>
            )}
            <Link
              href={`/app/opportunities/${o.id}/quote`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
            >
              <FileText size={14} /> 見積書
            </Link>
          </div>
        }
      />

      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">見込み金額</div><div className="stat-value stat-accent mt-1">{formatYen(o.amount)}</div></Card>
        <Card><div className="text-xs text-ink/50">粗利見込み</div><div className="text-2xl font-bold mt-1 tabular-nums">{formatYen(o.gross_profit)}</div><div className="text-xs text-ink/40 mt-0.5">{formatPercent(o.gross_profit_rate, 0)}</div></Card>
        <Card><div className="text-xs text-ink/50">確度 / Weighted</div><div className="text-2xl font-bold mt-1 tabular-nums">{o.probability}%</div><div className="text-xs text-ink/40 mt-0.5">{formatYen(o.weighted)}</div></Card>
        <Card><div className="text-xs text-ink/50">受注予定 / 計上月</div><div className="text-lg font-bold mt-1">{formatDateFull(o.expected_close_date)}</div><div className="text-xs text-ink/40 mt-0.5">{formatMonth(o.expected_revenue_month)}</div></Card>
      </div>

      {/* リスク診断(将来AI) */}
      {risk.reasons.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-accent-orange">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-accent-orange mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-ink">リスク診断<span className="text-xs font-normal text-ink/40 ml-2">将来はAIがヨミの妥当性を診断します</span></div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {risk.reasons.map((r) => (
                  <span key={r} className="pill bg-amber-50 text-accent-orange">{RISK_LABELS[r]}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {searchParams.error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">{searchParams.error}</div>
      )}
      {searchParams.saved && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">✓ {SAVED_MSG[searchParams.saved] ?? "保存しました"}</div>
      )}

      {/* 現状メモ・ヨミ: この案件が「いま」どういう状況かを常に最新化して伝える(最上部で即編集) */}
      <Section
        title="現状メモ・ヨミ（最新状況）"
        className={`mb-5 ${entityBorder("opportunity")}`}
        action={<span className="text-[11px] text-ink/40">この案件が今どういう状況かを一言で。ヨミと一緒に常に最新化</span>}
      >
        <form action={updateOppMemoAction} className="space-y-3">
          <input type="hidden" name="id" value={o.id} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">ヨミ</label>
              <select name="yomi" defaultValue={o.yomi ?? ""} className="input">
                <option value="">—</option>
                {YOMI_OPTIONS.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
              </select>
              <p className="text-[10px] text-ink/40 mt-1">ステージ・予測区分・確度も自動更新</p>
            </div>
            <div className="md:col-span-3">
              <label className="label">現状メモ</label>
              <textarea name="notes" rows={2} defaultValue={o.notes ?? ""} className="input" placeholder="例：予算取り中。9月の役員会で決裁予定。競合はA社。次回は事例提示で背中を押す。" />
            </div>
          </div>
          <SubmitButton className="btn-primary" pendingLabel="保存中…">現状を更新</SubmitButton>
        </form>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* 左: 編集 + 情報 */}
        <div className="lg:col-span-2 space-y-5">
          <ScheduleSection oppId={o.id} schedule={schedule} hadFirstMeeting={!!o.first_meeting_date} templates={templates} />

          <Section title="事前リサーチ・営業戦略" className={entityBorder("opportunity")} action={<EditTarget level="opportunity" />}>
            <form action={saveOppResearchAction} className="space-y-3">
              <input type="hidden" name="id" value={o.id} />
              <div>
                <label className="label">事前リサーチ情報</label>
                <textarea name="pre_research" rows={4} defaultValue={o.pre_research ?? ""} placeholder="企業概要・業界課題・想定AI活用テーマ・類似事例など（当面は担当営業がリサーチしコピペ）" className="input" />
              </div>
              <div>
                <label className="label">事前営業戦略</label>
                <textarea name="sales_strategy" rows={3} defaultValue={o.sales_strategy ?? ""} placeholder="リサーチを踏まえた初回トーク方針・聞くべき質問・提案の仮説" className="input" />
              </div>
              <SubmitButton className="btn-accent" pendingLabel="保存中…">保存</SubmitButton>
            </form>
          </Section>

          <Section title={`商談（${meetings.length}回）`} className={entityBorder("meeting")} action={<EditTarget level="meeting" />}>
            <MeetingList meetings={meetings} />
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">＋ 商談を登録</summary>
              <form action={createMeetingAction} className="mt-3 space-y-3 border-t border-black/[0.05] pt-3">
                <input type="hidden" name="opportunity_id" value={o.id} />
                <input type="hidden" name="account_id" value={o.account_id} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">タイトル</label>
                    <input name="title" required className="input" placeholder="例：初回商談 / 2回目 提案" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">商談日</label>
                      <input name="meeting_date" type="date" className="input" />
                    </div>
                    <div>
                      <label className="label">時間</label>
                      <input name="meeting_time" type="time" className="input" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">形式</label>
                    <select name="method" className="input" defaultValue="">
                      <option value="">—</option>
                      <option value="訪問">訪問</option>
                      <option value="オンライン">オンライン</option>
                      <option value="電話">電話</option>
                      <option value="その他">その他</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">担当</label>
                    <select name="owner_user_id" defaultValue={o.owner_user_id} className="input">
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">議事・要点</label>
                  <textarea name="summary" rows={2} className="input" placeholder="課題・予算・決裁者・反応・次の打ち手など（短い要約）" />
                </div>
                <div>
                  <label className="label">議事録詳細</label>
                  <textarea name="minutes_detail" rows={4} className="input" placeholder="議事録の全文・文字起こしを貼り付け（今後、要約はAIで自動生成予定）" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">次アクション日</label>
                    <input name="next_action_date" type="date" className="input" />
                  </div>
                  <div>
                    <label className="label">次アクション内容</label>
                    <input name="next_action_text" className="input" />
                  </div>
                </div>
                <MeetingTaskInputs />
                <SubmitButton className="btn-accent" pendingLabel="登録中…">商談を登録</SubmitButton>
              </form>
            </details>
          </Section>

          <Section title="案件を更新" className={entityBorder("opportunity")} action={<EditTarget level="opportunity" />}>
            <form action={updateOpportunityAction} className="space-y-4">
              <input type="hidden" name="id" value={o.id} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">ヨミ</label>
                  <select name="yomi" defaultValue={o.yomi ?? ""} className="input">
                    <option value="">—</option>
                    {YOMI_OPTIONS.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
                  </select>
                  <p className="text-[10px] text-ink/40 mt-1">ステージ・予測区分・確度はヨミから自動設定</p>
                </div>
                <div>
                  <label className="label">分類</label>
                  <select name="category" defaultValue={o.category ?? ""} className="input">
                    <option value="">—</option>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">金額(円)</label>
                  <input name="amount" type="number" defaultValue={o.amount} className="input" />
                </div>
                <div>
                  <label className="label">リスク</label>
                  <select name="risk_level" defaultValue={o.risk_level ?? ""} className="input">
                    <option value="">—</option>
                    <option value="low">低</option>
                    <option value="middle">中</option>
                    <option value="high">高</option>
                  </select>
                </div>
                <div>
                  <label className="label">受注予定日</label>
                  <input name="expected_close_date" type="date" defaultValue={o.expected_close_date ?? ""} className="input" />
                </div>
                <div>
                  <label className="label">担当者予測確率(%)</label>
                  <input name="rep_probability" type="number" min={0} max={100} defaultValue={o.rep_probability ?? ""} className="input" placeholder="ヨミとは別の担当者の主観確率" />
                </div>
                <div>
                  <label className="label">継続見込み終了月（サブスク）</label>
                  <input name="renewal_until_month" type="month" defaultValue={o.renewal_until_month ? o.renewal_until_month.slice(0, 7) : ""} className="input" />
                </div>
                <div>
                  <label className="label">更新確度(%)（サブスク）</label>
                  <input name="renewal_probability" type="number" min={0} max={100} defaultValue={o.renewal_probability ?? ""} className="input" placeholder="継続すると見込む確度" />
                </div>
              </div>
              {/* 次アクションは「活動を記録」に一本化(以前はここと2箇所にあった)。
                  ステージ等の更新時に既存の次アクションを消さないよう hidden で保持する。 */}
              <input type="hidden" name="next_action_date" value={o.next_action_date ?? ""} />
              <input type="hidden" name="next_action_text" value={o.next_action_text ?? ""} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">失注理由（失注時のみ）</label>
                  <select name="lost_reason_code" defaultValue={o.lost_reason_code ?? ""} className="input">
                    <option value="">選択してください</option>
                    {LOST_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">負けた競合（競合起因のとき）</label>
                  <input name="lost_competitor" defaultValue={o.lost_competitor ?? ""} className="input" placeholder="例：○○社" />
                </div>
              </div>
              <div>
                <label className="label">失注の詳細（自由記述）</label>
                <input name="lost_reason" defaultValue={o.lost_reason ?? ""} className="input" placeholder="経緯・条件差など" />
              </div>
              <p className="text-[11px] text-ink/40">※ 次アクション日・内容は下の「活動を記録」で設定します（重複を避けるためここでは表示していません）。</p>
              <SubmitButton className="btn-primary" pendingLabel="保存中…">保存する</SubmitButton>
            </form>
          </Section>

          <Section title="請求スケジュール（売上計画）" action={<span className="text-xs text-ink/40">受注日とは別に請求(売上)を計画</span>}>
            <BillingSection schedules={billing} opportunityId={o.id} accountId={o.account_id} category={o.category} />
            <SubscriptionForm opportunityId={o.id} accountId={o.account_id} />
          </Section>

          <Section title="活動を記録" className={entityBorder("activity")} action={<EditTarget level="activity" />}>
            <form action={addActivityAction} className="space-y-3">
              <input type="hidden" name="opportunity_id" value={o.id} />
              <input type="hidden" name="account_id" value={o.account_id} />
              <input type="hidden" name="redirect_to" value={`/app/opportunities/${o.id}`} />
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="label">活動日</label>
                  <input name="activity_at" type="date" defaultValue={todayInput} className="input" />
                </div>
                <div className="col-span-1">
                  <label className="label">種別</label>
                  <select name="activity_type" className="input" defaultValue="meeting">
                    {ACTIVITY_TYPES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">タイトル</label>
                  <input name="title" required className="input" placeholder="例：初回商談を実施" />
                </div>
              </div>
              <div>
                <label className="label">内容（メモ）</label>
                <textarea name="body" rows={2} className="input" placeholder="将来：AIが課題・予算・決裁者・次アクションを自動抽出します" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">次アクション日</label>
                  <input name="next_action_date" type="date" className="input" />
                </div>
                <div>
                  <label className="label">次アクション内容</label>
                  <input name="next_action_text" className="input" />
                </div>
              </div>
              <SubmitButton className="btn-accent" pendingLabel="記録中…">活動を追加</SubmitButton>
            </form>

            {/* 記録済みの活動: 編集・削除できる(誤登録の取り消し) */}
            <div className="mt-4 pt-4 border-t border-black/[0.05]">
              <div className="text-xs font-semibold text-ink/50 mb-2">この案件の活動履歴（{activities.length}）<span className="font-normal text-ink/35 ml-1">— 誤りは各行の鉛筆/ゴミ箱で編集・削除できます</span></div>
              <OpportunityActivityList
                opportunityId={o.id}
                activities={activities.map((a) => ({
                  id: a.id, activity_type: a.activity_type, title: a.title, body: a.body ?? null,
                  activity_at: a.activity_at, next_action_date: a.next_action_date ?? null, next_action_text: a.next_action_text ?? null,
                  who: getUser(ws, a.owner_user_id)?.name ?? null,
                }))}
              />
            </div>
          </Section>

          <ProposalSection
            opportunityId={o.id}
            proposalRequired={Boolean(o.proposal_required)}
            proposalStatus={o.proposal_status ?? null}
            proposalDueDate={o.proposal_due_date ?? null}
          />

          <Section title="コメント（社内スレッド）" action={<span className="text-[11px] text-ink/40">本部指示・引継ぎをここに集約</span>}>
            <CommentThread
              opportunityId={o.id}
              comments={comments}
              members={members.map((u) => ({ id: u.id, name: u.name }))}
              currentUserId={ws.ctx.userId}
              isAdmin={["owner", "admin"].includes(ws.ctx.role)}
            />
          </Section>

          <Section title="統合タイムライン" action={<span className="text-[11px] text-ink/40">活動・商談・タスク・ステージ・コメントを時系列で</span>}>
            <UnifiedTimeline events={timeline} />
          </Section>
        </div>

        {/* 右: 情報 + タスク + 履歴(スクロール追従: 左で編集中も基本情報・顧客を常に参照できる) */}
        <div className="space-y-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <Section title="基本情報" className={entityBorder("opportunity")} action={<EditTarget level="opportunity" />}>
            <dl className="space-y-2.5 text-sm">
              <Row label="ヨミ"><YomiBadge yomi={o.yomi} /></Row>
              <Row label="担当者予測確率">{o.rep_probability != null ? `${o.rep_probability}%（${formatYen(Math.round((o.amount * o.rep_probability) / 100))}）` : "—"}</Row>
              <Row label="分類">{o.category ? CATEGORY_MAP[o.category]?.label : "—"}</Row>
              <Row label="初回商談日">{formatDateFull(o.first_meeting_date)}</Row>
              <Row label="担当営業"><span className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} />{o.owner?.name}</span></Row>
              {(o.appt_acquired_by || o.appt_acquired_on) && (
                <Row label="アポ獲得">
                  <span className="text-xs">
                    {ws.usersById.get(o.appt_acquired_by ?? "")?.name ?? "—"}
                    {o.appt_acquired_on ? `（${formatDateFull(o.appt_acquired_on)}）` : ""}
                  </span>
                </Row>
              )}
              <Row label="主商材">{o.product?.name ?? "—"}</Row>
              <Row label="流入経路">{o.leadSource?.name ?? "—"}</Row>
              <Row label="流入詳細（どの展示会・施策）">
                {o.source_detail || o.campaign?.name || "—"}
              </Row>
              <Row label="最終活動">{since != null ? `${since}日前` : "—"}</Row>
              <Row label="作成日">{formatDateFull(o.created_at)}</Row>
            </dl>
            {o.notes && (
              <div className="mt-3 pt-3 border-t border-black/[0.05]">
                <div className="text-xs text-ink/45 mb-1">現状メモ</div>
                <p className="text-sm text-ink/80 whitespace-pre-wrap">{o.notes}</p>
              </div>
            )}

            {/* 基本情報の編集(案件名・担当営業の割振り/変更ほか) */}
            <details className="mt-4 pt-3 border-t border-black/[0.05]">
              <summary className="cursor-pointer text-sm font-medium text-teal-deep">基本情報を編集（担当営業の割振り・変更）</summary>
              <form action={updateOpportunityBasicsAction} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={o.id} />
                <div>
                  <label className="label">案件名</label>
                  <input name="name" defaultValue={o.name} required className="input" />
                </div>
                <div>
                  <label className="label">担当営業{!canReassign && <span className="text-[10px] text-ink/40 ml-1">（変更は代表・管理者・Sales Opsのみ）</span>}</label>
                  {canReassign ? (
                    <select name="owner_user_id" defaultValue={o.owner_user_id} className="input">
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <div className="input bg-mist-soft/40 text-ink/60 flex items-center">{o.owner?.name ?? "—"}</div>
                  )}
                </div>
                <div>
                  <label className="label">主商材</label>
                  <select name="primary_product_id" defaultValue={o.primary_product_id ?? ""} className="input">
                    <option value="">—</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <SourceSelect
                  sources={leadSources.map((l) => ({ id: l.id, name: l.name }))}
                  details={sourceDetails}
                  defaultSourceId={o.lead_source_id ?? ""}
                  defaultDetail={o.source_detail ?? ""}
                />
                <div>
                  <label className="label">初回商談日</label>
                  <input name="first_meeting_date" type="date" defaultValue={o.first_meeting_date ?? ""} className="input" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">アポ獲得者</label>
                    <select name="appt_acquired_by" defaultValue={o.appt_acquired_by ?? ""} className="input">
                      <option value="">—</option>
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">アポ獲得日</label>
                    <input name="appt_acquired_on" type="date" defaultValue={o.appt_acquired_on ?? ""} className="input" />
                  </div>
                </div>
                <SubmitButton className="btn-primary" pendingLabel="保存中…">基本情報を保存</SubmitButton>
              </form>
            </details>

            {/* 展示会・施策の紐付け(修正可) */}
            <form action={setOpportunityCampaignAction} className="mt-4 pt-3 border-t border-black/[0.05]">
              <input type="hidden" name="id" value={o.id} />
              <label className="label flex items-center gap-1.5">
                展示会・施策
                {o.campaign_estimated && o.campaign && (
                  <span className="pill bg-mist-soft text-ink/40 text-[9px]">推定</span>
                )}
              </label>
              <div className="flex gap-2">
                <select name="campaign_id" defaultValue={o.campaign_id ?? ""} className="input flex-1">
                  <option value="">—（紐付けなし）</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <SubmitButton className="btn-ghost shrink-0" pendingLabel="確定中…">確定</SubmitButton>
              </div>
              {o.campaign_estimated && (
                <p className="text-[11px] text-ink/40 mt-1">作成日から自動推定。正しい展示会を選び直して確定すると確定値になります。</p>
              )}
            </form>
          </Section>

          <Section title="顧客 / 担当者">
            <div className="text-sm">
              {o.account && (
                <Link href={`/app/accounts/${o.account.id}`} className="font-semibold text-teal-deep hover:underline">{o.account.name}</Link>
              )}
              <div className="text-xs text-ink/50 mt-0.5">{o.account?.industry} ・ {o.account?.area}</div>
              {contacts.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {contacts.map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-ink/50 ml-1">{c.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="タスク">
            {tasks.length === 0 ? (
              <p className="text-sm text-ink/40 py-2">タスクはありません</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between text-sm">
                    <span className={t.status === "done" ? "line-through text-ink/40" : ""}>{t.title}</span>
                    <span className="text-xs text-ink/40">{formatDateFull(t.due_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="ステージ変更履歴">
            {history.length === 0 ? (
              <p className="text-sm text-ink/40 py-2">履歴はありません</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <div className="flex items-center gap-1.5 text-xs">
                      {h.from_stage && <span className="text-ink/40">{STAGE_MAP[h.from_stage]?.label}</span>}
                      <span className="text-ink/30">→</span>
                      <span className="font-medium text-teal-deep">{STAGE_MAP[h.to_stage]?.label}</span>
                    </div>
                    <div className="text-xs text-ink/40 mt-0.5">{formatDateFull(h.changed_at)} ・ {getUser(ws, h.changed_by)?.name ?? "—"}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <AttachmentSection targetType="opportunity" targetId={o.id} revalidatePath={`/app/opportunities/${o.id}`} />

          <ChangeHistory table="opportunities" recordId={o.id} />
        </div>
      </div>

      {/* 削除(控えめ・確認つき) */}
      <Card className="mt-8 border-l-4 border-l-rose-300">
        <details>
          <summary className="cursor-pointer text-sm text-ink/50">危険な操作（この案件を削除）</summary>
          <form action={deleteOpportunityAction} className="mt-3 flex items-center gap-3 flex-wrap">
            <input type="hidden" name="id" value={o.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 px-3 py-1.5 text-sm hover:bg-rose-100">
              <Trash2 size={15} /> この案件を削除する
            </button>
            <span className="text-xs text-ink/40">削除後30日間は「設定 → ゴミ箱」から復元できます。商談・活動・請求などの配下データも一緒に非表示になり、復元時に戻ります。</span>
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
