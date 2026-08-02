"use client";

/**
 * メモ・議事録の一覧表示。タイル（サムネイル・デフォルト）⇔リストを切り替えられる。
 * 選択は localStorage に保存し、次回以降も維持する。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Link2, Mic, FileText, CornerDownRight } from "lucide-react";
import type { MemoPageListItem } from "@/lib/data/memos";
import { MEMO_KIND_LABEL } from "@/lib/memo";
import { formatDateTimeJst } from "@/lib/utils";

type ViewMode = "tile" | "list";
const STORAGE_KEY = "memos:view";

function KindPill({ kind }: { kind: MemoPageListItem["kind"] }) {
  return (
    <span className={`pill shrink-0 ${kind === "minutes" ? "bg-teal-light text-teal-deep" : "bg-mist-soft text-ink/60"}`}>
      {MEMO_KIND_LABEL[kind]}
    </span>
  );
}

export function MemoListView({ pages }: { pages: MemoPageListItem[] }) {
  // SSRとの不一致を避けるため、初期はタイルで描画し、マウント後に保存値を反映する
  const [view, setView] = useState<ViewMode>("tile");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "list") setView("list");
    } catch {
      /* プライベートモード等は無視 */
    }
  }, []);

  const switchTo = (v: ViewMode) => {
    setView(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* noop */
    }
  };

  return (
    <div>
      {/* 表示切替 */}
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-lg border border-black/[0.08] p-0.5" role="group" aria-label="表示切替">
          <button
            type="button"
            onClick={() => switchTo("tile")}
            aria-pressed={view === "tile"}
            title="タイル表示"
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              view === "tile" ? "bg-teal-light text-teal-deep" : "text-ink/45 hover:text-ink/70"
            }`}
          >
            <LayoutGrid size={13} /> タイル
          </button>
          <button
            type="button"
            onClick={() => switchTo("list")}
            aria-pressed={view === "list"}
            title="リスト表示"
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              view === "list" ? "bg-teal-light text-teal-deep" : "text-ink/45 hover:text-ink/70"
            }`}
          >
            <List size={13} /> リスト
          </button>
        </div>
      </div>

      {view === "tile" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pages.map((p) => (
            <Link
              key={p.id}
              href={`/app/memos/${p.id}`}
              className="block rounded-xl border border-black/[0.06] p-4 hover:border-teal-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-bold text-ink line-clamp-1">{p.title}</span>
                <KindPill kind={p.kind} />
              </div>
              {p.parentTitle && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/40">
                  <CornerDownRight size={11} /> {p.parentTitle}
                </div>
              )}
              {p.bodyPreview && <p className="mt-1 line-clamp-2 text-xs text-ink/50 whitespace-pre-wrap">{p.bodyPreview}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink/45">
                {p.oppName && (
                  <span className="pill bg-amber-50 text-accent-orange inline-flex items-center gap-1">
                    <Link2 size={10} /> {p.oppName}
                    {p.meetingTitle ? ` / ${p.meetingTitle}` : ""}
                  </span>
                )}
                {p.recordingCount > 0 && (
                  <span className="pill bg-rose-50 text-rose-600 inline-flex items-center gap-1">
                    <Mic size={10} /> 録音 {p.recordingCount}
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
                  <FileText size={11} /> {formatDateTimeJst(p.updated_at)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-black/[0.05] rounded-xl border border-black/[0.06]">
          {pages.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/memos/${p.id}`}
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-mist-soft/60 transition-colors"
              >
                <KindPill kind={p.kind} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold text-ink text-sm">{p.title}</span>
                  {p.parentTitle && <span className="ml-1.5 text-[11px] text-ink/40">（{p.parentTitle} 配下）</span>}
                  {p.bodyPreview && (
                    <span className="ml-2 hidden md:inline text-xs text-ink/40">
                      {p.bodyPreview.replace(/\s+/g, " ").slice(0, 60)}
                    </span>
                  )}
                </span>
                {p.oppName && (
                  <span className="hidden sm:inline-flex pill bg-amber-50 text-accent-orange items-center gap-1 max-w-[16rem] truncate">
                    <Link2 size={10} /> {p.oppName}
                    {p.meetingTitle ? ` / ${p.meetingTitle}` : ""}
                  </span>
                )}
                {p.recordingCount > 0 && (
                  <span className="pill bg-rose-50 text-rose-600 inline-flex items-center gap-1 shrink-0">
                    <Mic size={10} /> {p.recordingCount}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-ink/40 tabular-nums">{formatDateTimeJst(p.updated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
