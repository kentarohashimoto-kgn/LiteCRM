"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 全画面共通の操作フィードバック(監査UX 2026-07-12)。
 * - 送信中: 画面全体をオーバーレイでロック(二重操作の事故防止)＋「更新中…」アニメーション
 * - 完了:   大きなチェックマークが描かれる完了アニメーション(約1秒)→自動で消える
 * - 失敗:   赤の×シェイク(理由は各ページのバナーに表示)
 *
 * 仕組み: window.fetch をラップし、Server Action(POST + next-action ヘッダ)の実行中を検知。
 * 完了は ?saved= / 失敗は ?error= のリダイレクトパラメータで検知し、表示後にURLから除去する。
 * 個々のフォームに手を入れずアプリ全体で有効。
 */

// ---- Server Action 実行中の全体カウンタ(モジュールスコープ) ----
let inflight = 0;
const listeners = new Set<(n: number) => void>();
const notify = () => listeners.forEach((l) => l(inflight));

function hasNextActionHeader(h: HeadersInit | undefined): boolean {
  if (!h) return false;
  try {
    if (h instanceof Headers) return h.has("next-action");
    if (Array.isArray(h)) return h.some(([k]) => k.toLowerCase() === "next-action");
    return Object.keys(h).some((k) => k.toLowerCase() === "next-action");
  } catch {
    return false;
  }
}

function patchFetchOnce() {
  const w = window as unknown as { __fbPatched?: boolean };
  if (w.__fbPatched) return;
  w.__fbPatched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let isAction = false;
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      isAction =
        method === "POST" &&
        (hasNextActionHeader(init?.headers) || (input instanceof Request && input.headers.has("next-action")));
    } catch {
      isAction = false;
    }
    if (!isAction) return orig(input, init);
    inflight += 1;
    notify();
    try {
      return await orig(input, init);
    } finally {
      inflight -= 1;
      notify();
    }
  };
}

type Phase = "idle" | "pending" | "success" | "error";

export function FeedbackOverlay() {
  const [phase, setPhase] = useState<Phase>("idle");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledUrl = useRef<string>("");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  // 送信中の検知(fetchラップ)
  useEffect(() => {
    patchFetchOnce();
    let safety: ReturnType<typeof setTimeout> | null = null;
    const onChange = (n: number) => {
      if (n > 0) {
        // 成功/失敗アニメーション中は上書きしない
        if (phaseRef.current === "idle") setPhase("pending");
        if (safety) clearTimeout(safety);
        safety = setTimeout(() => setPhase((p) => (p === "pending" ? "idle" : p)), 20_000); // スタック防止
      } else {
        if (safety) clearTimeout(safety);
        // リダイレクト無しのアクションはここで閉じる(リダイレクト有りは saved/error 側が引き継ぐ)
        setTimeout(() => setPhase((p) => (p === "pending" ? "idle" : p)), 150);
      }
    };
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
      if (safety) clearTimeout(safety);
    };
  }, []);

  // 完了/失敗の検知(?saved= / ?error=)
  useEffect(() => {
    const url = `${pathname}?${searchParams.toString()}`;
    if (handledUrl.current === url) return;
    handledUrl.current = url;

    const saved = searchParams.get("saved") ?? searchParams.get("ok"); // ok=既存アクションの成功通知
    const error = searchParams.get("error");
    if (saved) {
      setPhase("success");
      const t = setTimeout(() => {
        // 再生後にURLからsaved/okを除去(リロード/共有時の再生防止)。バナーの代わりにこのアニメが完了通知。
        const params = new URLSearchParams(searchParams.toString());
        params.delete("saved");
        params.delete("ok");
        router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
        setPhase("idle");
      }, 1200);
      return () => clearTimeout(t);
    }
    if (error) {
      setPhase("error");
      const t = setTimeout(() => setPhase("idle"), 1100); // 理由バナーはページ側に残る
      return () => clearTimeout(t);
    }
  }, [pathname, searchParams, router]);

  if (phase === "idle") return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white/65 backdrop-blur-[2px] fb-fade-in"
      aria-live="polite"
      aria-busy={phase === "pending"}
    >
      {phase === "pending" && (
        <div className="flex flex-col items-center gap-4">
          <div className="fb-spinner" />
          <div className="text-sm font-semibold text-teal-deep tracking-wide">更新中…</div>
        </div>
      )}

      {phase === "success" && (
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <span className="fb-ring" />
            <div className="fb-pop grid place-items-center h-24 w-24 rounded-full bg-teal-primary shadow-xl">
              <svg viewBox="0 0 52 52" className="h-12 w-12">
                <path className="fb-check" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" d="M14 27 L23 36 L38 17" />
              </svg>
            </div>
          </div>
          <div className="fb-rise text-base font-bold text-teal-deep">保存しました</div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-4">
          <div className="fb-shake grid place-items-center h-24 w-24 rounded-full bg-rose-500 shadow-xl">
            <svg viewBox="0 0 52 52" className="h-12 w-12">
              <path fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" d="M17 17 L35 35 M35 17 L17 35" />
            </svg>
          </div>
          <div className="fb-rise text-base font-bold text-rose-600">保存できませんでした</div>
        </div>
      )}
    </div>
  );
}
