"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, Loader2 } from "lucide-react";
import { getMeetingPanelAction, type MeetingPanelData } from "@/server/actions/meeting-panel";
import { YomiBadge } from "@/components/ui/badges";
import { formatDateFull, formatTimeJst, formatYen } from "@/lib/utils";

/**
 * 商談詳細サイドパネル。商談一覧から画面遷移せずに議事・要点やAI要約を確認できる。
 * ESCまたは背景クリックで閉じる。編集が要る時だけ「商談メモを開く」で詳細ページへ。
 */
export function MeetingSidePanel({ meetingId, onClose }: { meetingId: string | null; onClose: () => void }) {
  const [data, setData] = useState<MeetingPanelData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) { setData(null); return; }
    let alive = true;
    setLoading(true);
    getMeetingPanelAction(meetingId)
      .then((d) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [meetingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (meetingId) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meetingId, onClose]);

  if (!meetingId) return null;
  const m = data?.meeting;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl border-l border-black/10">
        {loading && !m && (
          <div className="flex h-full items-center justify-center text-ink/40"><Loader2 size={20} className="animate-spin" /></div>
        )}
        {data && !data.ok && <div className="p-5 text-sm text-rose-600">{data.error}</div>}
        {m && (
          <div className="p-5 space-y-4">
            {/* ヘッダー: 顧客 › 案件 › 商談 */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink/40 truncate">{m.accountName} › {m.oppName}</p>
                <h2 className="font-semibold text-ink mt-0.5 leading-snug">{m.title || "(商談名なし)"}</h2>
                <p className="text-sm text-ink/55">
                  {formatDateFull(m.meetingDate ?? m.meetingAt) || "日付未設定"}
                  {formatTimeJst(m.meetingAt) && ` ${formatTimeJst(m.meetingAt)}`}
                  {m.method && `／${m.method}`}
                </p>
              </div>
              <button onClick={onClose} className="text-ink/40 hover:text-ink shrink-0" aria-label="閉じる"><X size={18} /></button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href={`/app/opportunities/${m.opportunityId}/meetings/${m.id}`} className="btn-accent inline-flex items-center gap-1 text-xs">
                <ExternalLink size={13} /> 商談メモを開く
              </Link>
              <Link href={`/app/opportunities/${m.opportunityId}`} className="btn-ghost inline-flex items-center gap-1 text-xs">案件を開く</Link>
              {m.accountId && <Link href={`/app/accounts/${m.accountId}`} className="btn-ghost inline-flex items-center gap-1 text-xs">顧客を開く</Link>}
            </div>

            {/* 案件サマリ */}
            <div className="rounded-xl border border-black/10 divide-y divide-black/[0.05] text-xs">
              <Row label="ヨミ"><YomiBadge yomi={m.yomi} /></Row>
              <Row label="営業担当">
                {m.ownerName ?? "—"}
                {m.ownerFromOpp && <span className="ml-1 text-[10px] text-ink/35">(案件の担当)</span>}
              </Row>
              <Row label="見込み金額"><span className="tabular-nums">{formatYen(m.amount ?? 0)}</span></Row>
              <Row label="受注予定">{formatDateFull(m.expectedCloseDate) || "—"}</Row>
              <Row label="次アクション">
                {m.nextActionDate || m.nextActionText
                  ? `${formatDateFull(m.nextActionDate) || "日付未定"}${m.nextActionText ? ` ${m.nextActionText}` : ""}`
                  : "—"}
              </Row>
            </div>

            <Block title="議事・要点">{m.summary}</Block>
            <Block title="AI要約" note={m.aiSummaryAt ? `生成: ${formatDateFull(m.aiSummaryAt)}` : undefined}>{m.aiSummary}</Block>
            <Block title="議事録詳細" scroll>{m.minutesDetail}</Block>
          </div>
        )}
      </aside>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-20 shrink-0 text-ink/40">{label}</span>
      <span className="text-ink/75 break-all">{children}</span>
    </div>
  );
}

function Block({ title, note, scroll = false, children }: { title: string; note?: string; scroll?: boolean; children?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-ink/70">{title}{note && <span className="ml-1.5 font-normal text-[10px] text-ink/35">{note}</span>}</p>
      {children ? (
        <p className={`rounded-xl bg-mist-soft/50 p-3 text-xs text-ink/75 whitespace-pre-wrap leading-relaxed ${scroll ? "max-h-72 overflow-y-auto" : ""}`}>{children}</p>
      ) : (
        <p className="text-xs text-ink/35">—</p>
      )}
    </div>
  );
}
