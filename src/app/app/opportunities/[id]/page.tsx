import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Sparkles } from "lucide-react";
import { getCtx } from "@/lib/session";
import {
  getActivitiesByOpportunity,
  getContactsByAccount,
  getMemberships,
  getOpportunity,
  getStageHistory,
  getTasksByOpportunity,
  getUser,
} from "@/lib/data/store";
import { STAGES, FORECAST_CATEGORIES, STAGE_MAP, ACTIVITY_TYPES, ACTIVITY_TYPE_MAP } from "@/lib/constants";
import { Card, PageHeader, Section, Avatar } from "@/components/ui/primitives";
import { ForecastBadge, StageBadge, StatusBadge } from "@/components/ui/badges";
import { evaluateRisk, RISK_LABELS } from "@/lib/risk";
import { addActivityAction, updateOpportunityAction } from "@/server/actions";
import { formatYen, formatPercent, formatDateFull, formatMonth, daysSince } from "@/lib/utils";

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const ctx = getCtx();
  const o = getOpportunity(ctx, params.id);
  if (!o) notFound();

  const activities = getActivitiesByOpportunity(o.id);
  const tasks = getTasksByOpportunity(o.id);
  const history = getStageHistory(o.id);
  const contacts = o.account ? getContactsByAccount(o.account.id) : [];
  const owners = getMemberships(ctx).map((m) => getUser(m.user_id)).filter(Boolean);
  const risk = evaluateRisk(o);
  const since = daysSince(o.last_activity_at);

  return (
    <div>
      <Link href="/app/opportunities" className="inline-flex items-center gap-1 text-sm text-ink/50 hover:text-ink mb-3">
        <ChevronLeft size={16} /> 商談一覧
      </Link>
      <PageHeader
        title={o.account?.name ?? "商談"}
        subtitle={o.name}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={o.status} />
            <StageBadge stage={o.stage} />
            <ForecastBadge category={o.forecast_category} />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 左: 編集 + 情報 */}
        <div className="lg:col-span-2 space-y-5">
          <Section title="商談を更新">
            <form action={updateOpportunityAction} className="space-y-4">
              <input type="hidden" name="id" value={o.id} />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">ステージ</label>
                  <select name="stage" defaultValue={o.stage} className="input">
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}（{s.probability}%）</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">ヨミ</label>
                  <select name="forecast_category" defaultValue={o.forecast_category} className="input">
                    {FORECAST_CATEGORIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
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
                  <label className="label">次アクション日</label>
                  <input name="next_action_date" type="date" defaultValue={o.next_action_date ?? ""} className="input" />
                </div>
              </div>
              <div>
                <label className="label">次アクション内容</label>
                <input name="next_action_text" defaultValue={o.next_action_text ?? ""} className="input" placeholder="open商談は次アクションを必ず設定しましょう" />
              </div>
              <div>
                <label className="label">失注理由（失注時のみ）</label>
                <input name="lost_reason" defaultValue={o.lost_reason ?? ""} className="input" />
              </div>
              <button type="submit" className="btn-primary">保存する</button>
            </form>
          </Section>

          <Section title="活動を記録">
            <form action={addActivityAction} className="space-y-3">
              <input type="hidden" name="opportunity_id" value={o.id} />
              <input type="hidden" name="account_id" value={o.account_id} />
              <div className="grid grid-cols-3 gap-3">
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
              <button type="submit" className="btn-accent">活動を追加</button>
            </form>
          </Section>

          <Section title="活動タイムライン">
            {activities.length === 0 ? (
              <p className="text-sm text-ink/40 py-4 text-center">活動履歴はまだありません</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="h-2 w-2 rounded-full bg-teal-primary mt-1.5" />
                      <span className="flex-1 w-px bg-black/[0.06]" />
                    </div>
                    <div className="pb-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="pill bg-teal-light text-teal-deep">{ACTIVITY_TYPE_MAP[a.activity_type]?.label}</span>
                        <span className="text-sm font-medium text-ink">{a.title}</span>
                      </div>
                      {a.body && <p className="text-sm text-ink/60 mt-1">{a.body}</p>}
                      <div className="text-xs text-ink/40 mt-1">{formatDateFull(a.activity_at)} ・ {getUser(a.owner_user_id)?.name}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {/* 右: 情報 + タスク + 履歴 */}
        <div className="space-y-5">
          <Section title="基本情報">
            <dl className="space-y-2.5 text-sm">
              <Row label="担当営業"><span className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} />{o.owner?.name}</span></Row>
              <Row label="主商材">{o.product?.name ?? "—"}</Row>
              <Row label="流入経路">{o.leadSource?.name ?? "—"}</Row>
              <Row label="最終活動">{since != null ? `${since}日前` : "—"}</Row>
              <Row label="作成日">{formatDateFull(o.created_at)}</Row>
            </dl>
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
                    <div className="text-xs text-ink/40 mt-0.5">{formatDateFull(h.changed_at)} ・ {getUser(h.changed_by)?.name ?? "—"}</div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink/45 text-xs">{label}</dt>
      <dd className="text-ink/90 text-right">{children}</dd>
    </div>
  );
}
