"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Paperclip, Sparkles, X } from "lucide-react";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/ai-lab/attachments";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import {
  DEFAULT_SLIDES,
  DEFAULT_SLIDE_QUALITY,
  MAX_SLIDES,
  MIN_SLIDES,
  SLIDE_QUALITIES,
  SLIDE_QUALITY_LABELS,
  type SlideQuality,
} from "@/lib/ai-lab/slides";
import type { LabPendingAttachment } from "@/lib/ai-lab/ui-types";

/**
 * スライド作成の入口。デザインガイド・議事録を添付し、簡単な指示を書いて構成案を作る。
 * ここでは画像を作らない(構成案づくりだけ)。実費がかかるのは次の段。
 */
export function NewDeckForm({ slug, canGenerate }: { slug: string; canGenerate: boolean }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [count, setCount] = useState(DEFAULT_SLIDES);
  const [quality, setQuality] = useState<SlideQuality>(DEFAULT_SLIDE_QUALITY);
  const [pending, setPending] = useState<LabPendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    if (pending.length + list.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(`一度に添付できるのは ${MAX_ATTACHMENTS_PER_MESSAGE} 件までです`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("slug", slug);
      for (const f of Array.from(list)) form.append("files", f);
      const res = await fetch("/api/lab/upload", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        attachments?: LabPendingAttachment[];
      };
      if (!res.ok || !json.attachments) {
        setError(json.message ?? labErrorMessage(json.error));
        return;
      }
      setPending((prev) => [...prev, ...json.attachments!]);
    } catch {
      setError("ファイルのアップロードに失敗しました");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function createPlan() {
    if (planning || uploading) return;
    if (!instruction.trim() && pending.length === 0) {
      setError("指示を書くか、資料を添付してください");
      return;
    }
    setError(null);
    setPlanning(true);
    try {
      const res = await fetch("/api/lab/slides/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          instruction,
          count,
          quality,
          attachmentIds: pending.map((a) => a.id),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; deckId?: string };
      if (!res.ok || !json.deckId) {
        setError(
          json.error === "plan_failed"
            ? "構成案をうまく作れませんでした。指示を具体的にして、もう一度お試しください。"
            : labErrorMessage(json.error),
        );
        return;
      }
      router.push(`/lab/${slug}/slides/${json.deckId}`);
    } catch {
      setError("構成案の作成に失敗しました");
    } finally {
      setPlanning(false);
    }
  }

  if (!canGenerate) {
    return (
      <div className="card card-pad text-center">
        <AlertCircle className="mx-auto mb-2 text-accent-orange" />
        <p className="text-sm font-semibold text-ink">スライド作成が利用できません</p>
        <p className="mt-1 text-xs text-ink/60">
          この機能には Claude と画像生成の両方が必要です。運営にお問い合わせください。
        </p>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <h2 className="text-sm font-bold text-ink">新しいスライドを作る</h2>
      <p className="mt-1 text-xs text-ink/55">
        デザインガイド（画像）と議事録（テキスト・MD）を添付して、作りたいものを書いてください。
        まず構成案を作ります。画像の生成は構成案を確認してからです。
      </p>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={4}
        placeholder="例）NTTデータ関西向けの生成AI活用支援の提案書。添付のデザインガイドのトンマナで作ってください。"
        className="input mt-3 min-h-[96px] resize-y"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-ink/50">枚数</label>
        <input
          type="number"
          min={MIN_SLIDES}
          max={MAX_SLIDES}
          value={count}
          onChange={(e) => setCount(Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Number(e.target.value) || DEFAULT_SLIDES)))}
          className="input w-20 py-1.5 text-sm"
        />
        <span className="text-[11px] text-ink/45">最大 {MAX_SLIDES} 枚</span>

        <label className="text-xs font-semibold text-ink/50">画質</label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as SlideQuality)}
          className="input w-auto py-1.5 text-sm"
        >
          {SLIDE_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {SLIDE_QUALITY_LABELS[q].label}
            </option>
          ))}
        </select>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv"
          className="hidden"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || planning}
          className="btn-ghost ml-auto py-1.5 disabled:cursor-not-allowed"
        >
          <Paperclip size={15} />
          資料を添付
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ink/45">{SLIDE_QUALITY_LABELS[quality].hint}</p>

      {pending.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pending.map((a) => (
            <span
              key={a.id}
              className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-black/10 bg-mist-soft px-2 py-1 text-xs"
            >
              <Paperclip size={12} className="shrink-0 text-ink/40" />
              <span className="truncate">{a.fileName}</span>
              <button
                type="button"
                onClick={() => setPending((prev) => prev.filter((p) => p.id !== a.id))}
                className="shrink-0 text-ink/40 hover:text-rose-600"
                aria-label={`${a.fileName} を外す`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => void createPlan()} disabled={planning || uploading} className="btn-primary">
          <Sparkles size={16} />
          {planning ? "構成案を作成中…" : "構成案を作る"}
        </button>
        <span className="text-[11px] text-ink/40">
          {uploading ? "アップロード中…" : "この段階では画像を作らないので費用はほぼかかりません"}
        </span>
      </div>
    </div>
  );
}
