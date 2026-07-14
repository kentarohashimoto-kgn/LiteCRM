"use client";

import { useState } from "react";
import { Trash2, Pencil, Link2, Paperclip, Download, ExternalLink } from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { deleteKnowledgeAction } from "@/server/actions/knowledge";
import { KnowledgeEditor } from "@/components/knowledge/knowledge-editor";
import type { KnowledgeEntry, KnowledgeKind } from "@/lib/data/knowledge";

const KIND_META: Record<KnowledgeKind, { label: string; cls: string }> = {
  knowhow: { label: "ノウハウ", cls: "bg-teal-light text-teal-deep" },
  win_reason: { label: "成約理由", cls: "bg-emerald-100 text-emerald-700" },
  loss_reason: { label: "失注理由", cls: "bg-rose-100 text-rose-600" },
  case_study: { label: "事例", cls: "bg-amber-50 text-accent-orange border border-accent-orange/20" },
};

export function KnowledgeCard({ entry }: { entry: KnowledgeEntry }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded-lg border border-teal-primary/30 bg-teal-light/10 p-4">
        <div className="text-xs font-semibold text-teal-deep mb-3">ノウハウ・事例を編集</div>
        <KnowledgeEditor entry={entry} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const e = entry;
  return (
    <div className="rounded-lg border border-black/[0.06] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("pill", KIND_META[e.kind].cls)}>{KIND_META[e.kind].label}</span>
            {e.kind === "case_study" && (
              <span className="pill bg-mist-soft text-ink/60 border border-black/5">{e.is_own_company ? "自社" : "他社"}</span>
            )}
            {e.industry && <span className="text-xs text-ink/50">業種: {e.industry}</span>}
            {e.competitor && <span className="text-xs text-ink/50">競合: {e.competitor}</span>}
          </div>
          <div className="text-sm font-semibold text-ink">{e.title}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setEditing(true)} className="text-ink/30 hover:text-teal-deep transition-colors" title="編集" aria-label="編集">
            <Pencil size={15} />
          </button>
          <form action={deleteKnowledgeAction}>
            <input type="hidden" name="id" value={e.id} />
            <button type="submit" className="text-ink/30 hover:text-rose-600 transition-colors" title="削除" aria-label="削除">
              <Trash2 size={15} />
            </button>
          </form>
        </div>
      </div>

      {e.body && <div className="mt-1.5 text-sm text-ink/75 whitespace-pre-wrap leading-relaxed">{e.body}</div>}

      {/* 参考URL */}
      {e.reference_links.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {e.reference_links.map((l, i) => (
            <li key={i} className="flex items-center gap-1.5 text-sm min-w-0">
              <Link2 size={13} className="text-ink/35 shrink-0" />
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="text-teal-deep hover:underline truncate inline-flex items-center gap-1">
                {l.label || l.url}
                <ExternalLink size={11} className="shrink-0 opacity-60" />
              </a>
              {l.label && <span className="text-ink/35 text-xs truncate hidden sm:inline">{l.url}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* 添付ファイル */}
      {e.attachment_name && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-black/[0.06] bg-mist-soft/30 px-3 py-2">
          <Paperclip size={14} className="text-ink/40 mt-0.5 shrink-0" />
          <div className="min-w-0">
            {e.attachment_url ? (
              <a href={e.attachment_url} target="_blank" rel="noreferrer noopener" download className="text-sm text-teal-deep hover:underline inline-flex items-center gap-1">
                {e.attachment_name}
                <Download size={12} className="opacity-70" />
              </a>
            ) : (
              <span className="text-sm text-ink/70">{e.attachment_name}</span>
            )}
            {e.attachment_note && <div className="text-xs text-ink/55 mt-0.5">{e.attachment_note}</div>}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(e.tags ?? []).map((t) => (
          <span key={t} className="pill bg-mist-soft text-ink/60 text-[11px]">#{t}</span>
        ))}
        <span className="ml-auto text-[11px] text-ink/35">{formatDate(e.created_at)}</span>
      </div>
    </div>
  );
}
