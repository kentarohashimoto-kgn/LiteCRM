"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Loader2, Trash2, Download, AlertTriangle, CircleDot, ChevronDown } from "lucide-react";
import {
  createRecordingAction,
  getRecordingUploadUrlAction,
  finishRecordingAction,
  failRecordingAction,
  deleteRecordingAction,
} from "@/server/actions/recordings";
import type { RecordingRow } from "@/lib/data/recordings";

type Phase = "idle" | "prep" | "recording" | "uploading" | "done" | "error";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  recording: { label: "録音中", cls: "bg-rose-50 text-rose-600" },
  uploading: { label: "保存中", cls: "bg-amber-50 text-accent-orange" },
  uploaded: { label: "処理待ち（夜間に文字起こし）", cls: "bg-mist-soft text-ink/60" },
  transcribing: { label: "文字起こし中", cls: "bg-teal-light text-teal-deep" },
  done: { label: "完了", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失敗", cls: "bg-rose-100 text-rose-600" },
};

function pickMime(): string {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const m of cands) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
const extFromMime = (m: string) => (m.includes("mp4") ? "mp4" : "webm");
const fmtDur = (s?: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const fmtSize = (b?: number | null) => (b == null ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1e3))}KB`);

export function MeetingRecorder({
  meetingId = null,
  opportunityId = null,
  accountId = null,
  memoPageId = null,
  defaultTitle,
  recordings,
}: {
  meetingId?: string | null;
  opportunityId?: string | null;
  accountId?: string | null;
  /** メモ・議事録ページからの録音時に指定（商談・案件なしでも録音できる）。 */
  memoPageId?: string | null;
  defaultTitle: string;
  recordings: RecordingRow[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [captureBoth, setCaptureBoth] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<{ mic?: MediaStream; disp?: MediaStream | null; ac?: AudioContext }>({});
  const idRef = useRef<string | null>(null);
  const startedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBlobRef = useRef<Blob | null>(null);

  const cleanupStreams = () => {
    const s = streamsRef.current;
    s.mic?.getTracks().forEach((t) => t.stop());
    s.disp?.getTracks().forEach((t) => t.stop());
    try { s.ac?.close(); } catch { /* noop */ }
    streamsRef.current = {};
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const start = async () => {
    setError(null);
    setPhase("prep");
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("マイクの使用が許可されませんでした。ブラウザのマイク許可をご確認ください。");
      setPhase("error");
      return;
    }

    // 相手の声＝画面/タブの音声
    let disp: MediaStream | null = null;
    let hasSystemAudio = false;
    try {
      disp = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      if (disp && disp.getAudioTracks().length > 0) {
        hasSystemAudio = true;
      } else {
        disp?.getTracks().forEach((t) => t.stop());
        disp = null;
        const cont = window.confirm(
          "画面共有で「音声も共有」が選ばれていないため、相手の声は録音されません（自分の声のみ）。\nこのまま録音しますか？\n\n相手の声も録るには、停止→もう一度「録音開始」→共有ダイアログで音声共有にチェックしてください。",
        );
        if (!cont) { mic.getTracks().forEach((t) => t.stop()); setPhase("idle"); return; }
      }
    } catch {
      const cont = window.confirm("画面/タブの音声共有がキャンセル（または非対応）でした。自分の声（マイク）だけで録音しますか？");
      if (!cont) { mic.getTracks().forEach((t) => t.stop()); setPhase("idle"); return; }
    }
    // 画面の映像は不要なので停止（音声だけ使う）
    disp?.getVideoTracks().forEach((t) => t.stop());

    // ミックス
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ac = new AC();
    const dest = ac.createMediaStreamDestination();
    ac.createMediaStreamSource(mic).connect(dest);
    if (disp && hasSystemAudio) ac.createMediaStreamSource(disp).connect(dest);

    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    } catch {
      setError("このブラウザは録音に対応していません（Chrome / Edge をご利用ください）。");
      mic.getTracks().forEach((t) => t.stop());
      disp?.getTracks().forEach((t) => t.stop());
      setPhase("error");
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = onStop;

    const created = await createRecordingAction({ opportunityId, meetingId, accountId, memoPageId, title: defaultTitle });
    if (!created.ok) {
      setError(created.error);
      cleanupStreams();
      setPhase("error");
      return;
    }
    idRef.current = created.id;
    streamsRef.current = { mic, disp, ac };
    recRef.current = rec;
    setCaptureBoth(hasSystemAudio);
    rec.start(5000); // 5秒ごとにチャンク
    startedRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 1000);
    setPhase("recording");
  };

  const stop = () => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  };

  const onStop = async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const mime = recRef.current?.mimeType || pickMime() || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    lastBlobRef.current = blob;
    const dur = Math.round((Date.now() - startedRef.current) / 1000);
    cleanupStreams();
    setPhase("uploading");
    const id = idRef.current!;
    try {
      const up = await getRecordingUploadUrlAction({ id, ext: extFromMime(mime) });
      if (!up.ok) throw new Error(up.error);
      // gdrive=Drive resumable直送(容量制限なし) / supabase=従来の署名URL
      const headers: Record<string, string> = up.kind === "gdrive"
        ? { "content-type": mime }
        : { "content-type": mime, "x-upsert": "true" };
      const put = await fetch(up.signedUrl, { method: "PUT", headers, body: blob });
      if (!put.ok) throw new Error(`アップロードに失敗しました (${put.status})`);
      let driveFileId: string | null = null;
      if (up.kind === "gdrive") {
        const uploaded = (await put.json().catch(() => ({}))) as { id?: string };
        if (!uploaded.id) throw new Error("アップロード結果の取得に失敗しました");
        driveFileId = uploaded.id;
      }
      const fin = await finishRecordingAction({ id, durationSec: dur, sizeBytes: blob.size, mimeType: mime, driveFileId });
      if (!fin.ok) throw new Error(fin.error || "保存に失敗しました");
      setPhase("done");
      router.refresh();
    } catch (e: any) {
      try { await failRecordingAction({ id, error: String(e?.message ?? e) }); } catch { /* noop */ }
      setError(`${e?.message ?? "アップロードに失敗しました"}｜下の「音声をダウンロード」で手元に保存できます。`);
      setPhase("error");
    }
  };

  const downloadLast = () => {
    const b = lastBlobRef.current;
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `録音_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extFromMime(b.type)}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const remove = async (id: string) => {
    if (!window.confirm("この録音を削除しますか？（音声・文字起こしも削除されます）")) return;
    await deleteRecordingAction({ id });
    router.refresh();
  };

  const recording = phase === "recording";
  const busy = phase === "prep" || phase === "uploading";

  return (
    <div className="space-y-4">
      {/* コントロール */}
      <div className="rounded-xl border border-black/[0.06] bg-mist-soft/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {!recording ? (
            <button type="button" onClick={start} disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
              {phase === "prep" ? "準備中…" : phase === "uploading" ? "保存中…" : "録音開始"}
            </button>
          ) : (
            <button type="button" onClick={stop} className="btn inline-flex items-center gap-2 bg-rose-600 text-white hover:bg-rose-700">
              <Square size={15} /> 停止して保存
            </button>
          )}

          {recording && (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-rose-600">
              <CircleDot size={14} className="animate-pulse" /> {fmtDur(elapsed)}
              <span className="text-xs font-normal text-ink/50">{captureBoth ? "・相手の声＋自分の声" : "・自分の声のみ"}</span>
            </span>
          )}
          {phase === "done" && <span className="text-sm text-emerald-600">✓ 保存しました（夜間に文字起こしします）</span>}

          <button type="button" onClick={() => setShowGuide((v) => !v)} className="ml-auto text-xs text-ink/50 hover:text-teal-deep inline-flex items-center gap-1">
            録音のやり方 <ChevronDown size={13} className={showGuide ? "rotate-180 transition" : "transition"} />
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              {error}
              {lastBlobRef.current && (
                <button type="button" onClick={downloadLast} className="ml-2 inline-flex items-center gap-1 text-teal-deep hover:underline">
                  <Download size={13} /> 音声をダウンロード
                </button>
              )}
            </div>
          </div>
        )}

        {showGuide && (
          <div className="mt-3 rounded-lg bg-white border border-black/[0.06] p-3 text-xs text-ink/70 space-y-1.5">
            <p><b>相手の声も録るコツ</b>（開始時の共有ダイアログで必ず「音声も共有」にチェック）：</p>
            <p>・<b>Windows</b>：会議アプリのままでOK。「画面全体」を共有＋「システム音声も共有」。</p>
            <p>・<b>Mac</b>：会議を <b>Chrome/Edge のWeb版タブ</b>で開き、「Chromeタブ」を共有＋タブ音声。（Mac＋アプリは相手の声を録れません）</p>
            <p>・<b>Meet</b>は元々ブラウザなのでタブ共有でOK。<b>Teams/Zoom</b>はMacならWeb版で開く。ヘッドホン推奨。</p>
            <p className="text-ink/45">対応ブラウザ：Chrome / Edge。録音は相手の同意を得たうえで行ってください。</p>
          </div>
        )}
      </div>

      {/* 録音一覧 */}
      {recordings.length > 0 && (
        <ul className="space-y-2">
          {recordings.map((r) => {
            const m = STATUS_META[r.status] ?? { label: r.status, cls: "bg-mist-soft text-ink/60" };
            return (
              <li key={r.id} className="rounded-lg border border-black/[0.06] p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`pill text-[11px] ${m.cls}`}>{m.label}</span>
                  {r.transcript_source && <span className="pill bg-black/[0.04] text-ink/50 text-[10px]">出典: {r.transcript_source === "tldv" ? "tl;dv" : "Whisper"}</span>}
                  <span className="text-xs text-ink/50 tabular-nums">{fmtDur(r.duration_sec)}{r.size_bytes ? ` ・ ${fmtSize(r.size_bytes)}` : ""}</span>
                  <span className="text-xs text-ink/35 ml-auto tabular-nums">{r.created_at.slice(0, 16).replace("T", " ")}</span>
                  <button type="button" onClick={() => remove(r.id)} className="text-ink/30 hover:text-rose-600" title="削除" aria-label="削除"><Trash2 size={14} /></button>
                </div>
                {r.audioUrl && (
                  <audio controls preload="none" src={r.audioUrl} className="mt-2 w-full h-9" />
                )}
                {r.error && <p className="mt-1.5 text-xs text-rose-600">{r.error}</p>}
                {r.summary && (
                  <div className="mt-2">
                    <div className="text-[11px] font-bold text-ink/45 mb-0.5">AI議事録</div>
                    <p className="text-xs text-ink/75 whitespace-pre-wrap">{r.summary}</p>
                  </div>
                )}
                {r.transcript && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-teal-deep cursor-pointer">文字起こし全文</summary>
                    <p className="mt-1 text-xs text-ink/70 whitespace-pre-wrap max-h-64 overflow-y-auto">{r.transcript}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
