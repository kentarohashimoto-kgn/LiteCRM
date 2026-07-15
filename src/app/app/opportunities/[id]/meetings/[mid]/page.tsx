import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getWorkspaceForOpportunity } from "@/lib/data/workspace";
import { ContactLine } from "@/components/contacts/contact-line";
import { getMeeting, getOpportunity, getContactsByAccount, getActivitiesByOpportunity, getUser, listMembers } from "@/lib/data/select";
import { Card, PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { YomiBadge } from "@/components/ui/badges";
import { updateMeetingAction } from "@/server/actions";
import { AiSummaryButton } from "@/components/meetings/ai-summary-button";
import { MeetingRecorder } from "@/components/meetings/meeting-recorder";
import { listMeetingRecordings } from "@/lib/data/recordings";
import { DataPath, EditTarget, entityBorder } from "@/components/layout/data-path";
import { SubmitButton } from "@/components/ui/submit-button";
import { ACTIVITY_TYPE_MAP, canReassignOwner, YOMI_OPTIONS } from "@/lib/constants";
import { formatDateFull, formatYen } from "@/lib/utils";

function hm(iso?: string): string {
  if (!iso) return "";
  // サーバ(UTC)描画でも常にJST表示にする
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16);
}

/**
 * 商談メモ画面。
 * 商談中に「顧客情報・事前リサーチ・営業戦略」を参照しながらメモを取れるよう、
 * 左=メモ入力(商談を編集) / 右=参照パネル(スクロール追従) の2カラム構成。
 */
export default async function MeetingDetailPage({ params, searchParams }: { params: { id: string; mid: string }; searchParams: { saved?: string } }) {
  const ws = await getWorkspaceForOpportunity(params.id);
  const meeting = getMeeting(ws, params.mid);
  if (!meeting || meeting.opportunity_id !== params.id) notFound();
  const opp = getOpportunity(ws, params.id);
  const time = hm(meeting.meeting_at);
  const contacts = opp?.account ? getContactsByAccount(ws, opp.account.id) : [];
  const recentActivities = opp ? getActivitiesByOpportunity(ws, opp.id).slice(0, 3) : [];
  const members = listMembers(ws).map(({ user }) => user);
  const canReassign = canReassignOwner(ws.ctx.role);
  const recordings = await listMeetingRecordings(meeting.id);

  return (
    <div>
      <Link href={`/app/opportunities/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 案件へ戻る
      </Link>
      {/* データ階層: 顧客 > 案件 > 商談(いまここ) */}
      <DataPath
        items={[
          ...(meeting.account ? [{ level: "account" as const, name: meeting.account.name, href: `/app/accounts/${meeting.account.id}` }] : []),
          { level: "opportunity", name: opp?.name, href: `/app/opportunities/${params.id}` },
          { level: "meeting", name: meeting.title, current: true },
        ]}
      />
      <PageHeader title={meeting.title} subtitle={`${meeting.account?.name ?? ""}｜案件: ${opp?.name ?? "—"}`} />

      {searchParams.saved && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">✓ 商談メモを保存しました</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">商談日</div><div className="text-lg font-bold mt-1">{formatDateFull(meeting.meeting_date ?? meeting.meeting_at)}</div></Card>
        <Card><div className="text-xs text-ink/50">時間</div><div className="text-lg font-bold mt-1">{time || <span className="text-ink/30">未設定</span>}</div></Card>
        <Card><div className="text-xs text-ink/50">形式 / 担当</div><div className="mt-1 flex items-center gap-1.5"><Avatar user={meeting.owner} size={22} /><span className="text-sm font-medium">{meeting.owner?.name ?? "—"}{meeting.method ? `・${meeting.method}` : ""}</span></div></Card>
        <Card><div className="text-xs text-ink/50">次アクション</div><div className="text-sm font-bold mt-1">{formatDateFull(meeting.next_action_date)}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* 左: 商談メモの入力(商談中はここに書く) */}
        <div className="lg:col-span-2 space-y-5">
          {/* 録音（ブラウザで録音→夜間に文字起こし・要約） */}
          <Section title="録音（商談を録音 → 夜間に文字起こし・AI議事録）">
            <MeetingRecorder
              meetingId={meeting.id}
              opportunityId={meeting.opportunity_id}
              accountId={meeting.account?.id ?? null}
              defaultTitle={meeting.title}
              recordings={recordings}
            />
          </Section>

          <Section title="商談メモ（この画面のまま右の情報を参照できます）" className={entityBorder("meeting")} action={<EditTarget level="meeting" />}>
            <form action={updateMeetingAction} className="space-y-4">
              <input type="hidden" name="id" value={meeting.id} />
              <input type="hidden" name="opportunity_id" value={meeting.opportunity_id} />
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">タイトル</label>
                  <input name="title" defaultValue={meeting.title} className="input" placeholder="例：初回商談 / 2回目 提案" />
                </div>
                <div>
                  <label className="label">商談日</label>
                  <input name="meeting_date" type="date" defaultValue={meeting.meeting_date ?? ""} className="input" />
                </div>
                <div>
                  <label className="label">時間</label>
                  <input name="meeting_time" type="time" defaultValue={time} className="input" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">形式</label>
                  <select name="method" defaultValue={meeting.method ?? ""} className="input">
                    <option value="">—</option>
                    <option value="訪問">訪問</option>
                    <option value="オンライン">オンライン</option>
                    <option value="電話">電話</option>
                    <option value="その他">その他</option>
                  </select>
                </div>
                <div>
                  <label className="label">ヨミ（案件に反映）</label>
                  <select name="yomi" defaultValue={opp?.yomi ?? ""} className="input">
                    <option value="">— 変更なし</option>
                    {YOMI_OPTIONS.map((y) => <option key={y.key} value={y.key}>{y.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">担当{!canReassign && <span className="text-[10px] text-ink/40 ml-1">（代表・管理者・SalesOpsのみ）</span>}</label>
                  {canReassign ? (
                    <select name="owner_user_id" defaultValue={meeting.owner_user_id ?? ""} className="input">
                      <option value="">—</option>
                      {members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <div className="input bg-mist-soft/40 text-ink/60 flex items-center">{meeting.owner?.name ?? "—"}</div>
                  )}
                </div>
              </div>
              <div>
                <label className="label">議事・要点（短い要約）</label>
                <textarea name="summary" rows={3} defaultValue={meeting.summary ?? ""} className="input" placeholder="課題・予算・決裁者・反応・次の打ち手など" />
              </div>
              <div>
                <label className="label">議事録詳細（商談中のメモはここへ）</label>
                <textarea name="minutes_detail" rows={12} defaultValue={meeting.minutes_detail ?? ""} className="input" placeholder="商談しながらここにメモ。全文・文字起こしの貼り付けもOK（保存後にAI要約できます）" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">次アクション日</label>
                  <input name="next_action_date" type="date" defaultValue={meeting.next_action_date ?? ""} className="input" />
                </div>
                <div>
                  <label className="label">次アクション内容</label>
                  <input name="next_action_text" defaultValue={meeting.next_action_text ?? ""} className="input" />
                </div>
              </div>
              <SubmitButton className="btn-primary" pendingLabel="保存中…">保存する（続けて編集できます）</SubmitButton>
            </form>
          </Section>

          {/* D-4: AI要約 */}
          <Section
            title="AI要約"
            action={<AiSummaryButton meetingId={meeting.id} opportunityId={params.id} hasMinutes={Boolean(meeting.minutes_detail && meeting.minutes_detail.trim().length >= 30)} />}
          >
            {meeting.ai_summary ? (
              <div>
                <p className="text-sm text-ink/80 whitespace-pre-wrap">{meeting.ai_summary}</p>
                {meeting.ai_summary_at && <p className="text-[11px] text-ink/35 mt-2">生成: {formatDateFull(meeting.ai_summary_at)}</p>}
              </div>
            ) : (
              <p className="text-sm text-ink/40 py-2">
                議事録詳細を保存して「AIで要約」を押すと、要点・決定事項・次アクションを自動生成します。
              </p>
            )}
          </Section>
        </div>

        {/* 右: 参照パネル(スクロールに追従)。商談中にカンペとして見る場所 */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <Section title="案件サマリ" className={entityBorder("opportunity")} action={
            <Link href={`/app/opportunities/${params.id}`} className="inline-flex items-center gap-1 text-[11px] text-teal-deep hover:underline">案件を開く <ExternalLink size={11} /></Link>
          }>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><dt className="text-xs text-ink/45">ヨミ</dt><dd><YomiBadge yomi={opp?.yomi} /></dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="text-xs text-ink/45">見込み金額</dt><dd className="tabular-nums font-semibold">{formatYen(opp?.amount ?? 0)}</dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="text-xs text-ink/45">受注予定</dt><dd>{formatDateFull(opp?.expected_close_date)}</dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="text-xs text-ink/45">次アクション</dt><dd className="text-right text-xs">{opp?.next_action_date ? `${formatDateFull(opp.next_action_date)} ${opp.next_action_text ?? ""}` : "—"}</dd></div>
            </dl>
          </Section>

          <Section title="事前リサーチ（カンペ）" className={entityBorder("opportunity")}>
            {opp?.pre_research ? (
              <p className="text-xs text-ink/75 whitespace-pre-wrap max-h-64 overflow-y-auto">{opp.pre_research}</p>
            ) : (
              <p className="text-xs text-ink/40">未入力です。案件詳細の「事前リサーチ・営業戦略」に書くと、ここに出ます。</p>
            )}
          </Section>

          <Section title="事前営業戦略" className={entityBorder("opportunity")}>
            {opp?.sales_strategy ? (
              <p className="text-xs text-ink/75 whitespace-pre-wrap max-h-48 overflow-y-auto">{opp.sales_strategy}</p>
            ) : (
              <p className="text-xs text-ink/40">未入力です。</p>
            )}
          </Section>

          <Section title="顧客 / アカウンター" className={entityBorder("account")}>
            {opp?.account && (
              <div className="text-sm">
                <Link href={`/app/accounts/${opp.account.id}`} className="font-semibold text-teal-deep hover:underline">{opp.account.name}</Link>
                <div className="text-xs text-ink/50 mt-0.5">{opp.account.industry} ・ {opp.account.area}</div>
              </div>
            )}
            {(() => {
              const accounterId = ws.opportunities.find((x) => x.id === opp?.id)?.contact_id ?? null;
              const accounter = contacts.find((c) => c.id === accounterId) ?? null;
              const others = contacts.filter((c) => c.id !== accounterId);
              return (
                <>
                  {accounter && <div className="mt-2.5"><ContactLine c={accounter} isAccounter showEmail /></div>}
                  {!accounter && contacts.length > 0 && (
                    <p className="mt-2.5 text-[11px] text-ink/40">アカウンター未設定（案件詳細で設定できます）</p>
                  )}
                  {others.length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {others.map((c) => (
                        <li key={c.id}><ContactLine c={c} showEmail /></li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </Section>

          <Section title="直近の活動" className={entityBorder("activity")}>
            {recentActivities.length === 0 ? (
              <p className="text-xs text-ink/40">活動記録はまだありません</p>
            ) : (
              <ul className="space-y-2">
                {recentActivities.map((a) => (
                  <li key={a.id} className="text-xs">
                    <span className="pill bg-emerald-50 text-emerald-700 text-[10px] mr-1.5">{ACTIVITY_TYPE_MAP[a.activity_type]?.label ?? a.activity_type}</span>
                    <span className="font-medium text-ink/80">{a.title}</span>
                    <span className="text-ink/40 ml-1">{formatDateFull(a.activity_at)}・{getUser(ws, a.owner_user_id)?.name ?? ""}</span>
                    {a.body && <p className="text-ink/55 mt-0.5 line-clamp-2">{a.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
