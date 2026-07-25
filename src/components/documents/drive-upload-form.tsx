"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createDriveUploadAction, finalizeDriveUploadAction, type DocumentTargetType } from "@/server/actions/documents";

/**
 * P1.5 種別付きアップロード(クライアント)。
 * ファイル本体はブラウザ→Google Drive へ直接PUT(resumable)するため、
 * Vercelのボディ上限(約4.5MB)の影響を受けない。録音級の大容量にも対応。
 * 保存先フォルダ・静止点(凍結コピー)の要否は種別からサーバー側が決定する。
 */
export function DriveUploadForm({
  targetType,
  targetId,
  revalidate,
  categories,
  snapshotForced,
  snapshotDefaultOn,
}: {
  targetType: DocumentTargetType;
  targetId: string;
  revalidate: string;
  categories: string[];
  snapshotForced: string[];
  snapshotDefaultOn: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<"idle" | "uploading" | "finalizing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState(categories[0] ?? "その他");
  const [snapshot, setSnapshot] = useState(snapshotDefaultOn.includes(categories[0] ?? ""));
  const fileRef = useRef<HTMLInputElement>(null);

  const forced = snapshotForced.includes(category);
  const busy = phase !== "idle" || pending;

  function onCategoryChange(next: string) {
    setCategory(next);
    setSnapshot(snapshotForced.includes(next) || snapshotDefaultOn.includes(next));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setPhase("uploading");
    try {
      const session = await createDriveUploadAction({
        category,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      if (!session.ok) { setError(session.error); setPhase("idle"); return; }

      // ブラウザ → Google Drive 直接アップロード
      const putRes = await fetch(session.sessionUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) { setError(`アップロード失敗(${putRes.status})`); setPhase("idle"); return; }
      const uploaded = (await putRes.json().catch(() => ({}))) as { id?: string };
      if (!uploaded.id) { setError("アップロード結果の取得に失敗しました"); setPhase("idle"); return; }

      setPhase("finalizing");
      const fin = await finalizeDriveUploadAction({
        fileId: uploaded.id,
        category,
        targetType,
        targetId,
        snapshot: forced || snapshot,
        revalidate,
      });
      if (!fin.ok) { setError(fin.error); setPhase("idle"); return; }
      if (fin.warning) setNotice(fin.warning);
      if (fileRef.current) fileRef.current.value = "";
      setPhase("idle");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      setPhase("idle");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileRef} type="file" required disabled={busy} className="text-sm text-ink/60 file:mr-2 file:rounded-lg file:border-0 file:bg-teal-light file:px-3 file:py-1.5 file:text-sm file:text-teal-deep file:cursor-pointer" />
        <select value={category} onChange={(e) => onCategoryChange(e.target.value)} disabled={busy} className="rounded-xl border border-black/10 px-2.5 py-1.5 text-sm">
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03] disabled:opacity-50">
          <Upload size={14} />
          {phase === "uploading" ? "アップロード中…" : phase === "finalizing" ? "登録中…" : "アップロード"}
        </button>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-xs text-ink/50">
        {forced ? (
          <span>この種別は証跡として、その時点の固定コピーも自動保存されます</span>
        ) : (
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={snapshot} onChange={(e) => setSnapshot(e.target.checked)} disabled={busy} />
            提出版として固定コピー(静止点)も保存する
          </label>
        )}
        <span>保存先は種別からドライブの所定フォルダに自動振り分け</span>
      </div>
      {error && <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">登録は完了しましたが: {notice}</p>}
    </form>
  );
}
