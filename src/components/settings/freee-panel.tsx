"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Link2, PlugZap, Unplug, CheckCircle2, AlertTriangle } from "lucide-react";
import { Section } from "@/components/ui/primitives";
import { formatYen, formatDateFull } from "@/lib/utils";
import type { FreeeOverview } from "@/lib/data/freee";
import type { PartnerMatch } from "@/lib/freee/types";
import {
  disconnectFreeeAction,
  importFreeePartnersAction,
  applyPartnerDecisionAction,
  syncFreeePaymentsAction,
} from "@/server/actions/freee";

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-mist-soft text-ink/60" },
  issued: { label: "発行済", cls: "bg-teal-light text-teal-deep" },
  paid: { label: "入金済", cls: "bg-emerald-100 text-emerald-700" },
};

export function FreeePanel({ overview }: { overview: FreeeOverview }) {
  const { status, invoices, linkCount, log, overdueCount } = overview;
  const [msg, setMsg] = useState<string | null>(null);
  const [matches, setMatches] = useState<PartnerMatch[] | null>(null);
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();

  const notify = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

  const runImport = () =>
    start(async () => {
      const r = await importFreeePartnersAction();
      if (!r.ok) return notify(r.error ?? "取込に失敗しました");
      setMatches(r.matches ?? []);
      setHandled(new Set());
      notify(`freee取引先 ${r.matches?.length ?? 0} 件を取得しました`);
    });

  const decide = (m: PartnerMatch, mode: "renamed" | "linked") =>
    start(async () => {
      if (!m.account_id) return;
      const r = await applyPartnerDecisionAction({ account_id: m.account_id, freee_id: m.freee_id, freee_name: m.freee_name, mode });
      if (!r.ok) return notify(r.error ?? "反映に失敗しました");
      setHandled((prev) => new Set(prev).add(m.freee_id));
      notify(mode === "renamed" ? "CRM顧客名をfreeeに合わせました" : "外部キー接続のみで対応表に追加しました");
    });

  const disconnect = () =>
    start(async () => {
      if (!confirm("freee接続を解除します。よろしいですか？")) return;
      const r = await disconnectFreeeAction();
      notify(r.ok ? "接続を解除しました" : r.error ?? "失敗しました");
    });

  const syncPay = () =>
    start(async () => {
      const r = await syncFreeePaymentsAction();
      notify(r.ok ? `入金を同期しました（更新 ${r.updated ?? 0} 件）` : r.error ?? "同期に失敗しました");
    });

  // 名寄せの確認が必要な行（名称差分・未マッチ・未リンク）を優先表示
  const needsReview = (matches ?? []).filter((m) => !m.already_linked && !handled.has(m.freee_id) && m.account_id && m.kind === "diff");
  const linkable = (matches ?? []).filter((m) => !m.already_linked && !handled.has(m.freee_id) && m.account_id && m.kind === "exact");

  return (
    <div className="space-y-5">
      {msg && <p className="text-xs text-teal-deep bg-teal-light rounded-lg px-3 py-2">{msg}</p>}

      {/* 接続状態 */}
      <Section title="接続" icon={<PlugZap size={16} className="text-teal-primary" />}>
        {status.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 pill bg-emerald-100 text-emerald-700 text-xs"><CheckCircle2 size={13} /> 接続済み</span>
            {status.company_name && <span className="text-sm text-ink/70">事業所: <b>{status.company_name}</b></span>}
            {status.connected_at && <span className="text-xs text-ink/40">接続日 {formatDateFull(status.connected_at.slice(0, 10))}</span>}
            <button onClick={disconnect} disabled={pending} className="ml-auto inline-flex items-center gap-1.5 text-sm text-rose-500 hover:underline">
              <Unplug size={14} /> 接続解除
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink/60">freee 会計に接続すると、取引先の名寄せ・見積/請求の発行・入金の取込ができます。</p>
            <a href="/api/freee/connect" className="btn-primary shrink-0 inline-flex items-center gap-1.5"><PlugZap size={15} /> freeeに接続</a>
          </div>
        )}
      </Section>

      {/* マスタ名寄せ */}
      <Section
        title="取引先マスタの名寄せ"
        icon={<Link2 size={16} className="text-teal-primary" />}
        action={
          <button onClick={runImport} disabled={pending || !status.connected} className="btn-accent inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> freee取引先を取り込む
          </button>
        }
      >
        <p className="text-xs text-ink/50 mb-3">
          既存マスタは <b>freeeが正</b>。名称が異なる取引先は<b>サイレント上書きしません</b>。行ごとに
          「名称をfreeeに合わせる」か「外部キー接続のみ（名称は各自維持）」を選んでください。
          現在の対応表: <b>{linkCount}</b> 件。
        </p>

        {matches === null ? (
          <p className="text-sm text-ink/40 py-2">「freee取引先を取り込む」で名寄せ候補を表示します。</p>
        ) : (
          <div className="space-y-4">
            {needsReview.length > 0 && (
              <div>
                <div className="text-xs font-bold text-amber-700 mb-2 inline-flex items-center gap-1"><AlertTriangle size={13} /> 名称が異なる（確認が必要）</div>
                <ul className="divide-y divide-black/[0.05]">
                  {needsReview.map((m) => (
                    <li key={m.freee_id} className="py-2.5 flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">CRM: <b>{m.account_name}</b></div>
                        <div className="text-xs text-ink/50">freee: {m.freee_name}</div>
                      </div>
                      <button onClick={() => decide(m, "renamed")} disabled={pending} className="text-xs rounded-lg bg-teal-primary text-white px-2.5 py-1 disabled:opacity-50">名称をfreeeに合わせる</button>
                      <button onClick={() => decide(m, "linked")} disabled={pending} className="text-xs rounded-lg border border-black/10 px-2.5 py-1 hover:bg-black/[0.03] disabled:opacity-50">外部キー接続のみ</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {linkable.length > 0 && (
              <div>
                <div className="text-xs font-bold text-ink/50 mb-2">名称一致（そのまま対応表に追加できます）</div>
                <ul className="divide-y divide-black/[0.05]">
                  {linkable.slice(0, 50).map((m) => (
                    <li key={m.freee_id} className="py-2 flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{m.account_name}</span>
                      <button onClick={() => decide(m, "linked")} disabled={pending} className="text-xs rounded-lg border border-black/10 px-2.5 py-1 hover:bg-black/[0.03] disabled:opacity-50">接続</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {needsReview.length === 0 && linkable.length === 0 && (
              <p className="text-sm text-ink/40 py-2">確認が必要な名寄せはありません（未マッチのfreee取引先はCRMに顧客がないため対象外）。</p>
            )}
          </div>
        )}
      </Section>

      {/* 請求書 */}
      <Section
        title="請求書"
        action={
          <button onClick={syncPay} disabled={pending || !status.connected} className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-black/10 px-2.5 py-1 hover:bg-black/[0.03] disabled:opacity-50">
            <RefreshCw size={13} className={pending ? "animate-spin" : ""} /> 入金を同期
          </button>
        }
      >
        {overdueCount > 0 && (
          <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-3 inline-flex items-center gap-1"><AlertTriangle size={13} /> 支払期日超過の請求書が {overdueCount} 件あります</p>
        )}
        {invoices.length === 0 ? (
          <p className="text-sm text-ink/40 py-2">請求書はまだありません。案件の「検収→請求」から作成します。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ink/45 text-left border-b border-black/[0.06]">
                  <th className="py-2 pr-3 font-medium">顧客 / 請求番号</th>
                  <th className="py-2 pr-3 font-medium">状態</th>
                  <th className="py-2 pr-3 font-medium text-right">金額</th>
                  <th className="py-2 pr-3 font-medium">発行日</th>
                  <th className="py-2 pr-3 font-medium">支払期日</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const st = INV_STATUS[i.status] ?? { label: i.status, cls: "bg-mist-soft text-ink/60" };
                  const overdue = i.status === "issued" && i.due_date && i.due_date < new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                  return (
                    <tr key={i.id} className="border-b border-black/[0.04]">
                      <td className="py-2 pr-3">
                        <div className="font-medium truncate max-w-[220px]">{i.account_name ?? "—"}</div>
                        {i.invoice_number && <div className="text-xs text-ink/40">{i.invoice_number}</div>}
                      </td>
                      <td className="py-2 pr-3"><span className={`pill text-[10px] ${st.cls}`}>{st.label}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatYen(i.amount)}</td>
                      <td className="py-2 pr-3 text-xs">{i.issue_date ? formatDateFull(i.issue_date) : "—"}</td>
                      <td className={`py-2 pr-3 text-xs ${overdue ? "text-rose-600 font-medium" : ""}`}>{i.due_date ? formatDateFull(i.due_date) : "—"}{overdue ? "（超過）" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 連携ログ */}
      <Section title="連携ログ（最近30件）">
        {log.length === 0 ? (
          <p className="text-sm text-ink/40 py-2">ログはまだありません。</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {log.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className={`pill text-[10px] ${l.result === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>{l.result}</span>
                <span className="font-mono text-ink/60">{l.op}</span>
                <span className="text-ink/40">{l.direction}</span>
                {l.message && <span className="text-ink/50 truncate">・{l.message}</span>}
                <span className="ml-auto text-ink/30">{formatDateFull(l.created_at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
