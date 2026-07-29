"use client";

import { useState } from "react";
import { Mail, Loader2, X, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  listMailTemplatesAction,
  previewLeadBulkMailAction,
  sendLeadBulkMailAction,
  type BulkMailPreview,
  type LeadMailFilters,
} from "@/server/actions/lead-mail";
import { EMAIL_CATEGORY_LABEL, renderEmailTemplate } from "@/lib/email";
import { SchedulePicker } from "@/components/email/schedule-picker";
import { formatJstSchedule } from "@/lib/schedule";
import { detectAdSignals, UNSUB_MODE_HINT, UNSUB_MODE_LABEL, type UnsubMode } from "@/lib/unsubscribe";

/**
 * リード一括メール送信パネル(D2: 手動トリガー)。
 * 現在の絞り込み条件を対象に、テンプレ選択→対象内訳プレビュー→確認→送信。
 * 送信は20件ずつのチャンクをクライアント側でループ(サーバーアクションのタイムアウト回避。
 * 送信済み除外により再実行しても二重送信しない)。
 */

interface TemplateOpt { id: string; name: string; category: string }

export function BulkMailPanel({ filters, selectedIds = [] }: { filters: LeadMailFilters; selectedIds?: string[] }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateOpt[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [segTitle, setSegTitle] = useState("");
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);  // 予約送信(null=即時)
  const [subj, setSubj] = useState("");   // 送信直前の直接編集(件名)
  const [body, setBody] = useState("");   // 送信直前の直接編集(本文)
  const [unsubMode, setUnsubMode] = useState<UnsubMode>("full");  // 配信停止の付け方(既定=本文フッターあり)
  const [preview, setPreview] = useState<BulkMailPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, target: 0 });
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // チェック選択があればそれを対象に、無ければ現在の絞り込み条件を対象にする
  const effectiveFilters: LeadMailFilters = selectedIds.length > 0 ? { leadIds: selectedIds } : filters;

  const openPanel = async () => {
    setOpen(true);
    setDone(null);
    setError(null);
    if (!templates) setTemplates(await listMailTemplatesAction());
  };

  const selectTemplate = async (id: string) => {
    setTemplateId(id);
    setPreview(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const p = await previewLeadBulkMailAction(effectiveFilters, id);
      if (!p.ok) setError(p.error ?? "プレビューに失敗しました");
      else {
        setPreview(p);
        setSubj(p.subjectTmpl ?? "");
        setBody(p.bodyTmpl ?? "");
      }
    } finally {
      setLoading(false);
    }
  };

  // 直接編集後の差し込みプレビュー(先頭リードのサンプル値でクライアント側レンダリング)
  const sampleVars = {
    contact: preview?.sampleContact || "(担当者名)",
    company: preview?.sampleCompany || "(会社名)",
    opportunity: "",
    // 差出人依存({sender}/{sender_last}/{sender_email}/{signature})はサーバーで解決済みの値を使う
    ...(preview?.senderVars ?? { sender: preview?.senderName || "", sender_last: "", sender_email: "", signature: "" }),
  };

  // 「純粋なお礼のみ」を選んでいるのに広告宣伝にあたりうる要素が本文にある場合の注意喚起。
  // ガイドライン上は一部でも広告宣伝が含まれれば特定電子メールに該当するため、フッターを勧める。
  const adSignals = unsubMode === "header_only" ? detectAdSignals(subj, body) : [];

  const send = async () => {
    if (!preview?.sendable) return;
    const when = scheduleAt ? `${formatJstSchedule(scheduleAt)} に送信予約します` : "メールを送信します";
    const footerNote = unsubMode === "full"
      ? "配信停止フッター・開封/クリック計測が自動で付きます"
      : "本文フッターは付けません（配信停止ヘッダ・開封/クリック計測は付きます）";
    if (adSignals.length > 0) {
      const reasons = adSignals.map((s) => `・${s.label}（「${s.hit}」）`).join("\n");
      if (!confirm(
        `本文に広告宣伝にあたりうる要素が見つかりました:\n${reasons}\n\n` +
        `一部でも広告宣伝が含まれる場合、特定電子メール法により本文への配信停止表示が必要です。\n` +
        `「広告宣伝を含む」に切り替えることを強く推奨します。\n\nこのまま本文フッターなしで送信しますか？`,
      )) return;
    }
    if (!confirm(`${preview.sendable}件のリードに${when}。よろしいですか？\n(${footerNote})`)) return;
    setSending(true);
    setError(null);
    let sent = 0;
    let failed = 0;
    let scheduled = 0;
    let batchId: string | undefined;
    const target = preview.sendable;
    setProgress({ sent, failed, target });
    try {
      // 20件ずつ完了までループ。送信済みはサーバー側で自動除外されるため冪等。
      // 初回チャンクがセグメント履歴を作り、以降は同じbatchIdへ積む。
      for (let guard = 0; guard < 30; guard++) {
        const r = await sendLeadBulkMailAction(effectiveFilters, templateId, 20, {
          batchId, segmentTitle: segTitle, subjectTmpl: subj, bodyTmpl: body,
          scheduledAtIso: scheduleAt ?? undefined, unsubMode,
        });
        batchId = r.batchId ?? batchId;
        if (!r.ok) {
          if (sent === 0 && scheduled === 0) { setError(r.error ?? "送信に失敗しました"); return; }
          break; // 途中から対象0になった等 → 完了扱い
        }
        sent += r.sent ?? 0;
        failed += r.failed ?? 0;
        scheduled += r.scheduled ?? 0;
        setProgress({ sent: sent + scheduled, failed, target });
        // 予約はサーバー側で対象全件を1回で積むため、チャンクを繰り返さない
        if (scheduleAt) break;
        if ((r.sent ?? 0) === 0) break;
        if (sent + failed >= target) break;
      }
      setDone(scheduleAt
        ? `${scheduled}件を ${formatJstSchedule(scheduleAt)} に送信予約しました`
        : `送信 ${sent}件 / 失敗 ${failed}件${failed > 0 ? "（失敗分は送信履歴で確認できます）" : ""}`);
      setPreview(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button onClick={openPanel} className={selectedIds.length > 0 ? "btn-accent inline-flex items-center gap-1.5 text-xs" : "btn-ghost inline-flex items-center gap-1.5 text-xs"} title="チェック選択 or 絞り込み結果へテンプレメールを一括送信">
        <Mail size={14} /> {selectedIds.length > 0 ? `選択${selectedIds.length}件へ一括メール` : "一括メール"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !sending && setOpen(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-ink flex items-center gap-2">
                <Mail size={16} /> 一括メール送信（{selectedIds.length > 0 ? `チェック選択 ${selectedIds.length}件` : "現在の絞り込み対象"}）
              </h2>
              <button onClick={() => !sending && setOpen(false)} className="text-ink/40 hover:text-ink"><X size={18} /></button>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-ink/50">テンプレート（<a href="/app/email/templates" className="underline" target="_blank">編集はこちら</a>）</label>
              <select value={templateId} onChange={(e) => selectTemplate(e.target.value)} disabled={sending} className="input">
                <option value="">選択してください</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>[{EMAIL_CATEGORY_LABEL[t.category] ?? t.category}] {t.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-ink/50">セグメント名（履歴・反応分析に表示。空欄なら自動命名）</label>
              <input
                value={segTitle}
                onChange={(e) => setSegTitle(e.target.value)}
                disabled={sending}
                placeholder="例: AIDX展1日目・S/Aランクお礼"
                maxLength={100}
                className="input"
              />
            </div>

            {loading && <p className="text-sm text-ink/50 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 対象を確認中…</p>}
            {error && <p className="text-sm text-rose-600 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}

            {preview && (
              <div className="space-y-3">
                <div className="rounded-xl bg-mist-soft/60 p-3 text-sm space-y-1">
                  <p className="font-semibold text-ink">送信対象: {preview.sendable}件 {preview.capped && <span className="text-amber-600 text-xs">(300件上限。残りは再実行で送信)</span>}</p>
                  <p className="text-xs text-ink/55">
                    絞り込み一致 {preview.totalMatched}件 / メールなし {preview.noEmail} / アドレス重複 {preview.duplicateEmail} /
                    配信停止 {preview.suppressed} / 送信済み {preview.alreadySent} を除外
                  </p>
                  {typeof preview.dailyRemaining === "number" && (
                    <p className={`text-xs ${preview.dailyRemaining < (preview.sendable ?? 0) ? "text-amber-600 font-medium" : "text-ink/45"}`}>
                      本日の残り送信枠: {preview.dailyRemaining}通（送信者ごとに1日300通まで。超える分は明日 or 別の送信者で）
                    </p>
                  )}
                  {!preview.senderReady && (
                    <p className="text-xs text-rose-600 font-medium">
                      ⚠ 送信メールアカウントが未接続です。<a href="/app/email/account" className="underline" target="_blank">メール設定</a>から接続してください。
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs text-ink/50">件名（今回の送信だけ直接編集できます。{"{contact}"} {"{company}"} {"{sender}"} は差し込み可）</label>
                    <input value={subj} onChange={(e) => setSubj(e.target.value)} disabled={sending} className="input" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-ink/50">本文（テンプレは変更されません。編集内容は今回の全宛先に適用）</label>
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} rows={8} className="input font-normal leading-relaxed" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-ink/50">このメールの内容</label>
                  {(["full", "header_only"] as UnsubMode[]).map((m) => (
                    <label key={m} className="flex items-start gap-2 text-xs cursor-pointer rounded-lg border border-black/10 p-2 hover:bg-mist-soft/40">
                      <input
                        type="radio"
                        name="unsub-mode"
                        checked={unsubMode === m}
                        onChange={() => setUnsubMode(m)}
                        disabled={sending}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-ink/80">{UNSUB_MODE_LABEL[m]}</span>
                        <span className="block text-ink/45">{UNSUB_MODE_HINT[m]}</span>
                      </span>
                    </label>
                  ))}
                  {adSignals.length > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 flex items-start gap-1.5">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        本文に広告宣伝にあたりうる要素があります（{adSignals.map((s) => s.label).join(" / ")}）。
                        一部でも広告宣伝が含まれると特定電子メール法の表示義務の対象になるため、「広告宣伝を含む」を選んでください。
                      </span>
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-black/10 p-3 text-xs space-y-1 max-h-40 overflow-y-auto bg-mist-soft/30">
                  <p className="font-semibold text-ink/70">差し込みプレビュー（先頭のリード: {preview.sampleContact || "—"}）</p>
                  <p className="text-ink/80">件名: {renderEmailTemplate(subj, sampleVars) || "(件名なし)"}</p>
                  <p className="whitespace-pre-wrap text-ink/60">{renderEmailTemplate(body, sampleVars)}</p>
                  <p className="text-ink/40 pt-1">
                    {unsubMode === "full"
                      ? "※末尾に配信停止フッターが自動で付きます"
                      : "※本文フッターは付きません（Gmail等が出す配信停止ボタン用のヘッダのみ付きます）"}
                  </p>
                </div>
              </div>
            )}

            {sending && (
              <div className="text-sm text-ink/70 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                送信中… {progress.sent + progress.failed} / {progress.target} 件（このまま閉じずにお待ちください）
              </div>
            )}
            {done && (
              <p className="text-sm text-teal-deep flex items-center gap-1.5">
                <CheckCircle2 size={15} /> {done}
                <a href={scheduleAt ? "/app/email/scheduled" : "/app/email/segments"} className="underline text-xs" target="_blank">
                  {scheduleAt ? "予約一覧で確認・変更" : "送信履歴・反応分析を見る"}
                </a>
              </p>
            )}

            <div className="flex flex-wrap justify-end items-center gap-2 pt-1">
              {preview?.sendable && !sending && <SchedulePicker value={scheduleAt} onChange={setScheduleAt} disabled={sending} />}
              <button onClick={() => setOpen(false)} disabled={sending} className="btn-ghost text-sm">閉じる</button>
              <button
                onClick={send}
                disabled={sending || !preview?.sendable || !preview.senderReady}
                className="btn-accent inline-flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                <Send size={14} /> {preview?.sendable ? `${preview.sendable}件を${scheduleAt ? "予約" : "送信"}` : "送信"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
