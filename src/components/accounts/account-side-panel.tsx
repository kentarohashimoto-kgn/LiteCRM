"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X, ExternalLink, Loader2, Building2, Mail, Phone, Globe, Plus,
  ChevronLeft, ChevronRight, AlertTriangle, Sparkles,
} from "lucide-react";
import {
  getAccountPanelAction,
  setAccountSegmentAction,
  setAccountRankAction,
  type AccountPanelData,
} from "@/server/actions/account-panel";
import { MATRIX_RANKS, type MatrixSegment } from "@/lib/account-matrix";
import { STAGE_MAP, ACTIVITY_TYPE_MAP, ACCOUNT_FOCUS_MAP } from "@/lib/constants";
import { cn, formatYen, formatDate, formatDateFull } from "@/lib/utils";

/**
 * 顧客分析マトリクスの右ペイン(特大 = 画面の約2/3)。
 * 顧客名クリックで開き、顧客サマリ・案件・担当者・活動履歴を遷移せずに確認する。
 * セグメントとランクはここで直接付け替えられる(未分類のまま放置されるのを防ぐため)。
 * ESC または背景クリックで閉じる。
 */

const STATUS_LABEL: Record<string, string> = { prospect: "見込み", customer: "顧客", inactive: "休眠" };
const DECISION_ROLE_LABEL: Record<string, string> = {
  decision_maker: "決裁者", influencer: "影響者", user: "利用者", referrer: "紹介者", gatekeeper: "窓口",
};

export function AccountSidePanel({
  accountId,
  segments,
  index,
  total,
  onClose,
  onNav,
}: {
  accountId: string | null;
  segments: MatrixSegment[];
  /** セル内での位置(0-based)。連続確認用 */
  index: number;
  total: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<AccountPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setErr(null);
    try {
      setData(await getAccountPanelAction(id));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId) { setData(null); return; }
    void load(accountId);
  }, [accountId, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" && index < total - 1) onNav(1);
      if (e.key === "ArrowUp" && index > 0) onNav(-1);
    };
    if (accountId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accountId, index, total, onClose, onNav]);

  const a = data?.account;

  /** セグメント・ランクの更新。競合時は再読込を促す(casUpdate の楽観ロック)。 */
  async function updateSegment(segmentId: string | null) {
    if (!a) return;
    setSaving(true); setErr(null);
    const r = await setAccountSegmentAction({ accountId: a.id, segmentId, updatedAt: a.updatedAt });
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "保存に失敗しました"); return; }
    setData((d) => (d?.account ? { ...d, account: { ...d.account, segmentId, updatedAt: r.updatedAt ?? d.account.updatedAt } } : d));
    router.refresh();
  }

  async function updateRank(rank: string | null) {
    if (!a) return;
    setSaving(true); setErr(null);
    const r = await setAccountRankAction({ accountId: a.id, rank, updatedAt: a.updatedAt });
    setSaving(false);
    if (!r.ok) { setErr(r.error ?? "保存に失敗しました"); return; }
    setData((d) => (d?.account ? { ...d, account: { ...d.account, rank, updatedAt: r.updatedAt ?? d.account.updatedAt } } : d));
    router.refresh();
  }

  if (!accountId) return null;

  const totals = data?.totals;
  const opps = data?.opportunities ?? [];
  const openOpps = opps.filter((o) => o.status === "open");
  const closedOpps = opps.filter((o) => o.status !== "open");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />
      {/* 特大ペイン: 画面の約2/3。狭い画面では全幅 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="顧客詳細"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-black/10 bg-white shadow-2xl lg:w-2/3"
      >
        {/* ヘッダー(固定) */}
        <div className="flex items-start gap-3 border-b border-black/[0.06] px-5 py-3.5">
          <div className="min-w-0 flex-1">
            {a ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="pill bg-mist-soft text-[10px] text-ink/60">{STATUS_LABEL[a.status] ?? a.status}</span>
                  {a.focus && ACCOUNT_FOCUS_MAP[a.focus] && (
                    <span className={cn("pill text-[10px] font-bold", ACCOUNT_FOCUS_MAP[a.focus].color)}>
                      {ACCOUNT_FOCUS_MAP[a.focus].label}
                    </span>
                  )}
                  {a.engagementRank && (
                    <span className="pill bg-mist-soft text-[10px] text-ink/50">
                      エンゲージ {a.engagementRank}
                      {a.engagementScore != null && ` (${a.engagementScore})`}
                    </span>
                  )}
                </div>
                <h2 className="mt-1 flex items-center gap-1.5 text-lg font-bold leading-snug text-ink">
                  <Building2 size={17} className="shrink-0 text-teal-primary" />
                  <span className="truncate">{a.name}</span>
                </h2>
                <p className="truncate text-xs text-ink/50">
                  {[a.industry, a.area, a.employeeSize, a.ownerName && `担当 ${a.ownerName}`].filter(Boolean).join(" ／ ") || "—"}
                </p>
              </>
            ) : (
              <h2 className="text-lg font-bold text-ink/40">読み込み中…</h2>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {total > 1 && (
              <>
                <button
                  onClick={() => onNav(-1)}
                  disabled={index <= 0}
                  title="前の顧客 (↑)"
                  className="rounded-lg p-1.5 text-ink/45 hover:bg-mist-soft hover:text-ink disabled:opacity-30"
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="tabular-nums text-[11px] text-ink/40">{index + 1}/{total}</span>
                <button
                  onClick={() => onNav(1)}
                  disabled={index >= total - 1}
                  title="次の顧客 (↓)"
                  className="rounded-lg p-1.5 text-ink/45 hover:bg-mist-soft hover:text-ink disabled:opacity-30"
                >
                  <ChevronRight size={17} />
                </button>
              </>
            )}
            {a && (
              <Link
                href={`/app/accounts/${a.id}`}
                className="btn-ghost inline-flex items-center gap-1 whitespace-nowrap text-xs"
              >
                <ExternalLink size={13} /> 詳細ページ
              </Link>
            )}
            <button onClick={onClose} title="閉じる (Esc)" className="rounded-lg p-1.5 text-ink/45 hover:bg-mist-soft hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 本文(スクロール) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !a && (
            <div className="flex h-40 items-center justify-center text-ink/40"><Loader2 size={22} className="animate-spin" /></div>
          )}
          {data && !data.ok && <div className="text-sm text-rose-600">{data.error}</div>}

          {a && (
            <div className="space-y-4">
              {err && (
                <div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  <AlertTriangle size={14} className="mt-px shrink-0" />
                  <span>{err}</span>
                </div>
              )}

              {/* 分類の付け替え */}
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-teal-primary/20 bg-teal-light/25 p-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-teal-deep">
                  セグメント
                  <select
                    value={a.segmentId ?? ""}
                    disabled={saving}
                    onChange={(e) => void updateSegment(e.target.value || null)}
                    className="input mt-1 w-full text-sm"
                  >
                    <option value="">自動判定（業種から）</option>
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}{s.isVisible ? "" : "（非表示）"}</option>
                    ))}
                  </select>
                  <span className="mt-1 block font-normal text-[11px] text-ink/45">
                    業種「{a.industry || "未設定"}」から自動判定中。ここで選ぶと固定されます。
                  </span>
                </label>

                <div className="text-xs font-semibold text-teal-deep">
                  ランク
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void updateRank(null)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-bold transition",
                        a.rank === null ? "bg-teal-primary text-white" : "border border-black/10 bg-white text-ink/50 hover:border-teal-primary/40"
                      )}
                    >
                      <Sparkles size={11} className="-mt-px mr-0.5 inline" />自動
                    </button>
                    {MATRIX_RANKS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        disabled={saving}
                        onClick={() => void updateRank(r.key)}
                        className={cn(
                          "w-8 rounded-lg py-1 text-xs font-bold transition",
                          a.rank === r.key ? r.color : "border border-black/10 bg-white text-ink/50 hover:border-teal-primary/40"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <span className="mt-1 block font-normal text-[11px] text-ink/45">
                    {a.rank === null ? "取引額・企業規模から自動判定しています。" : "手動で固定中。「自動」に戻せます。"}
                  </span>
                </div>
              </div>

              {/* 金額サマリ */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="累計受注" value={formatYen(totals?.won ?? 0)} accent />
                <Stat label="進行中見込み" value={formatYen(totals?.open ?? 0)} />
                <Stat label="失注" value={formatYen(totals?.lost ?? 0)} muted />
                <Stat label="案件数" value={`${totals?.oppCount ?? 0}件`} />
              </div>

              {/* 案件 */}
              <Block
                title={`案件（進行中 ${openOpps.length}件 / 完了 ${closedOpps.length}件）`}
                action={
                  <Link href={`/app/accounts/${a.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-primary hover:underline">
                    <Plus size={13} /> 案件を追加
                  </Link>
                }
              >
                {opps.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-ink/40">案件がありません。</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-black/[0.06] text-ink/50">
                        <tr>
                          <th className="th text-left">案件</th>
                          <th className="th text-left">ステージ</th>
                          <th className="th text-right">金額</th>
                          <th className="th text-right">確度</th>
                          <th className="th text-left">次アクション</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.04]">
                        {[...openOpps, ...closedOpps].map((o) => (
                          <tr key={o.id} className="row-hover">
                            <td className="td">
                              <Link href={`/app/opportunities/${o.id}`} className="font-medium text-ink hover:text-teal-primary hover:underline">
                                {o.name}
                              </Link>
                              <span className="block text-[10px] text-ink/40">
                                {o.ownerName ?? "担当未設定"}
                                {o.expectedCloseDate && ` ／ 成約予定 ${formatDate(o.expectedCloseDate)}`}
                              </span>
                            </td>
                            <td className="td">
                              <span
                                className={cn(
                                  "pill text-[10px]",
                                  o.status === "won" ? "bg-teal-light text-teal-deep"
                                    : o.status === "open" ? "bg-amber-50 text-accent-orange"
                                    : "bg-mist-soft text-ink/45"
                                )}
                              >
                                {STAGE_MAP[o.stage]?.label ?? o.stage}
                              </span>
                            </td>
                            <td className="td text-right font-semibold tabular-nums">{formatYen(o.amount)}</td>
                            <td className="td text-right tabular-nums text-ink/60">{o.probability}%</td>
                            <td className="td text-xs text-ink/60">
                              {o.nextActionText || o.nextActionDate ? (
                                <>
                                  <span className="block">{o.nextActionText ?? "—"}</span>
                                  {o.nextActionDate && <span className="text-[10px] text-ink/40">{formatDate(o.nextActionDate)}</span>}
                                </>
                              ) : (
                                <span className="text-ink/25">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Block>

              {/* 担当者 */}
              <Block title={`担当者（${data?.contacts?.length ?? 0}名）`}>
                {(data?.contacts ?? []).length === 0 ? (
                  <p className="px-1 py-3 text-xs text-ink/40">担当者が登録されていません。</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(data?.contacts ?? []).map((c) => (
                      <div key={c.id} className="rounded-lg border border-black/[0.06] px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-ink">{c.name}</span>
                          {c.decisionRole && (
                            <span className="pill bg-mist-soft text-[10px] text-ink/55">
                              {DECISION_ROLE_LABEL[c.decisionRole] ?? c.decisionRole}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink/50">{[c.department, c.title].filter(Boolean).join(" ／ ") || "—"}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          {c.email && (
                            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-teal-primary hover:underline">
                              <Mail size={11} />{c.email}
                            </a>
                          )}
                          {c.phone && (
                            <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-teal-primary hover:underline">
                              <Phone size={11} />{c.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Block>

              {/* 活動履歴 */}
              <Block title="直近の活動">
                {(data?.activities ?? []).length === 0 ? (
                  <p className="px-1 py-3 text-xs text-ink/40">活動履歴がありません。</p>
                ) : (
                  <ul className="divide-y divide-black/[0.04]">
                    {(data?.activities ?? []).map((x) => (
                      <li key={x.id} className="flex items-start gap-2 py-1.5">
                        <span className="pill mt-px shrink-0 bg-mist-soft text-[10px] text-ink/55">
                          {ACTIVITY_TYPE_MAP[x.activityType]?.label ?? x.activityType}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink/75">{x.title || "—"}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-ink/40">{formatDateFull(x.activityAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Block>

              {/* メモ・リンク */}
              {(a.notes || a.websiteUrl) && (
                <Block title="メモ">
                  {a.websiteUrl && (
                    <a
                      href={a.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-1.5 inline-flex items-center gap-1 text-xs text-teal-primary hover:underline"
                    >
                      <Globe size={12} />{a.websiteUrl}
                    </a>
                  )}
                  {a.notes && <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink/70">{a.notes}</p>}
                </Block>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, accent = false, muted = false }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2">
      <div className="text-[10px] text-ink/50">{label}</div>
      <div className={cn("text-base font-bold tabular-nums", accent && "text-teal-primary", muted && "text-ink/40")}>{value}</div>
    </div>
  );
}

function Block({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-ink/70">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
