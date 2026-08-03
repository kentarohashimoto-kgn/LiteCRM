"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Download, Image as ImageIcon, Pencil, Play, RefreshCw, Square } from "lucide-react";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import { slideProgress } from "@/lib/ai-lab/slides";
import type { LabUiDeck, LabUiSlideItem } from "@/lib/ai-lab/slides-ui-types";
import { updateSlideItemAction } from "@/server/actions/ai-lab-slides";
import { cn } from "@/lib/utils";

/**
 * 構成案の確認 → 1枚ずつ生成 → PPTX統合。
 *
 * 生成をブラウザ側のループにしているのは、10枚を1リクエストで作ると
 * 関数の実行時間上限(300秒)を超えるため。1枚=1リクエストなら上限内に収まり、
 * 進捗が見え、失敗した枚だけ作り直せる。タブを閉じると止まる点は割り切り。
 */
export function DeckClient({ slug, deck }: { slug: string; deck: LabUiDeck }) {
  const router = useRouter();
  const [items, setItems] = useState<LabUiSlideItem[]>(deck.items);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pptx, setPptx] = useState<{ url: string | null; fileName: string | null }>({
    url: deck.pptxUrl,
    fileName: deck.pptxFileName,
  });
  const [exporting, setExporting] = useState(false);
  const stopRef = useRef(false);

  const progress = slideProgress(items);

  const renderOne = useCallback(
    async (position: number): Promise<boolean> => {
      setCurrent(position);
      try {
        const res = await fetch("/api/lab/slides/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug, deckId: deck.id, position }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok || json.error) {
          setItems((prev) =>
            prev.map((i) =>
              i.position === position ? { ...i, status: "failed", errorCode: json.error ?? "provider_error" } : i,
            ),
          );
          setError(labErrorMessage(json.error));
          return false;
        }
        setItems((prev) =>
          prev.map((i) => (i.position === position ? { ...i, status: "done", errorCode: null } : i)),
        );
        return true;
      } catch {
        setItems((prev) => prev.map((i) => (i.position === position ? { ...i, status: "failed" } : i)));
        setError("画像の生成に失敗しました");
        return false;
      } finally {
        setCurrent(null);
      }
    },
    [slug, deck.id],
  );

  /** 未生成・失敗の枚を順に作る。1枚失敗しても最後まで続け、後から個別に作り直せる。 */
  async function runAll() {
    if (running) return;
    setError(null);
    setRunning(true);
    stopRef.current = false;
    try {
      const targets = items.filter((i) => i.status !== "done").map((i) => i.position);
      for (const position of targets) {
        if (stopRef.current) break;
        await renderOne(position);
      }
    } finally {
      setRunning(false);
      // 署名URLは期限付きなので、生成後はサーバーから取り直す。
      router.refresh();
    }
  }

  async function exportPptx() {
    if (exporting) return;
    setError(null);
    setExporting(true);
    try {
      const res = await fetch("/api/lab/slides/pptx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, deckId: deck.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        fileName?: string;
        missing?: number;
      };
      if (!res.ok || json.error) {
        setError(
          json.error === "slides_not_ready"
            ? "まだ生成済みのスライドがありません。先に画像を作ってください。"
            : labErrorMessage(json.error),
        );
        return;
      }
      setPptx({ url: json.url ?? null, fileName: json.fileName ?? null });
      if (json.missing && json.missing > 0) {
        setError(`未生成の ${json.missing} 枚を除いて統合しました。`);
      }
    } catch {
      setError("PPTXの作成に失敗しました");
    } finally {
      setExporting(false);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">
              {progress.done}/{progress.total} 枚 生成済み
              {progress.failed > 0 && <span className="ml-2 text-rose-600">（失敗 {progress.failed}）</span>}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist-soft">
              <div
                className="h-full rounded-full bg-teal-primary transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="btn-ghost">
              <Square size={16} />
              停止
            </button>
          ) : (
            <button type="button" onClick={() => void runAll()} disabled={progress.complete} className="btn-primary">
              <Play size={16} />
              {progress.done > 0 ? "残りを生成" : "この構成で画像を作る"}
            </button>
          )}

          <button
            type="button"
            onClick={() => void exportPptx()}
            disabled={exporting || progress.done === 0 || running}
            className="btn-ghost disabled:cursor-not-allowed"
          >
            <Download size={16} />
            {exporting ? "作成中…" : "PPTXにまとめる"}
          </button>
        </div>

        {running && current != null && (
          <p className="mt-3 text-xs text-teal-deep">{current} 枚目を生成しています…（1枚あたり30秒ほどかかります）</p>
        )}
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
        {pptx.url && (
          <a
            href={pptx.url}
            download={pptx.fileName ?? undefined}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-teal-light px-3 py-2 text-xs font-semibold text-teal-deep hover:bg-teal-light/70"
          >
            <Download size={14} />
            {pptx.fileName ?? "スライド.pptx"} をダウンロード
          </a>
        )}
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <SlideCard
            key={item.position}
            slug={slug}
            deckId={deck.id}
            item={item}
            busy={running || current === item.position}
            onRegenerate={() => void renderOne(item.position)}
            onSaved={(patch) =>
              setItems((prev) => prev.map((i) => (i.position === item.position ? { ...i, ...patch } : i)))
            }
          />
        ))}
      </ul>
    </div>
  );
}

function SlideCard({
  slug,
  deckId,
  item,
  busy,
  onRegenerate,
  onSaved,
}: {
  slug: string;
  deckId: string;
  item: LabUiSlideItem;
  busy: boolean;
  onRegenerate: () => void;
  onSaved: (patch: Partial<LabUiSlideItem>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: item.title,
    summary: item.summary,
    imagePrompt: item.imagePrompt,
    notes: item.notes,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateSlideItemAction({ slug, deckId, position: item.position, ...draft });
      // 内容を変えたら作り直しが要るので、生成済みでも未生成に戻る。
      onSaved({ ...draft, status: item.status === "done" ? "pending" : item.status });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="card card-pad">
      <div className="flex items-start gap-4">
        <div className="w-40 shrink-0">
          {item.imageUrl ? (
            // 生成結果は署名URL。next/image を通すと期限付きURLの最適化で扱いが面倒になる。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={`スライド${item.position}`}
              className="w-full rounded-lg border border-black/10"
            />
          ) : (
            <div
              className={cn(
                "flex aspect-video w-full items-center justify-center rounded-lg border border-dashed",
                item.status === "failed" ? "border-rose-300 bg-rose-50" : "border-black/15 bg-mist-soft",
              )}
            >
              {item.status === "failed" ? (
                <AlertCircle size={18} className="text-rose-500" />
              ) : busy ? (
                <RefreshCw size={18} className="animate-spin text-teal-primary" />
              ) : (
                <ImageIcon size={18} className="text-ink/25" />
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="input py-1.5 text-sm font-semibold"
                placeholder="見出し"
              />
              <textarea
                value={draft.summary}
                onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                rows={2}
                className="input resize-y text-xs"
                placeholder="このスライドで伝えること"
              />
              <textarea
                value={draft.imagePrompt}
                onChange={(e) => setDraft((d) => ({ ...d, imagePrompt: e.target.value }))}
                rows={5}
                className="input resize-y text-xs"
                placeholder="画像生成への指示（載せる文言をそのまま書いてください）"
              />
              <textarea
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                rows={2}
                className="input resize-y text-xs"
                placeholder="発表者ノート"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary py-1.5">
                  <Check size={14} />
                  保存
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn-ghost py-1.5">
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="pill bg-mist-soft text-ink/60">{item.position}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{item.title}</p>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md p-1.5 text-ink/40 hover:bg-mist-soft hover:text-ink"
                  aria-label="この構成を編集"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy}
                  className="rounded-md p-1.5 text-ink/40 hover:bg-mist-soft hover:text-ink disabled:cursor-not-allowed"
                  aria-label="このスライドだけ作り直す"
                >
                  <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
                </button>
              </div>
              {item.summary && <p className="mt-1 text-xs text-ink/60">{item.summary}</p>}
              <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-ink/40">{item.imagePrompt}</p>
              {item.status === "failed" && (
                <p className="mt-2 text-xs text-rose-600">{labErrorMessage(item.errorCode)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
