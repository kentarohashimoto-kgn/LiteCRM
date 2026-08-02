"use client";

/**
 * メモ・議事録ページのエディタ（Notionライク）。
 * ・タイトル＋本文はデバウンス自動保存（1秒）。blur/ページ離脱時もフラッシュ。
 * ・議事録は「テンプレート挿入」で書き出しの型をワンタップ投入。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ListPlus } from "lucide-react";
import { updateMemoPageAction } from "@/server/actions/memos";
import { minutesTemplate, type MemoKind } from "@/lib/memo";

type SaveState = "saved" | "dirty" | "saving" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "保存済み",
  dirty: "変更あり…",
  saving: "保存中…",
  error: "保存に失敗（通信をご確認ください）",
};

export function MemoEditor({
  pageId,
  kind,
  initialTitle,
  initialBody,
}: {
  pageId: string;
  kind: MemoKind;
  initialTitle: string;
  initialBody: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [state, setState] = useState<SaveState>("saved");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ title: initialTitle, body: initialBody });
  const savedRef = useRef({ title: initialTitle, body: initialBody });
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const cur = latestRef.current;
    if (cur.title === savedRef.current.title && cur.body === savedRef.current.body) return;
    setState("saving");
    const res = await updateMemoPageAction({ id: pageId, title: cur.title, body: cur.body });
    if (res.ok) {
      savedRef.current = { ...cur };
      // 保存中にさらに編集されていたら dirty のまま次のデバウンスに任せる
      setState(
        latestRef.current.title === cur.title && latestRef.current.body === cur.body ? "saved" : "dirty",
      );
    } else {
      setState("error");
    }
  }, [pageId]);

  const scheduleSave = useCallback(
    (next: { title?: string; body?: string }) => {
      latestRef.current = { ...latestRef.current, ...next };
      setState("dirty");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 1000);
    },
    [flush],
  );

  // 離脱ガード（未保存があれば警告し、可能なら保存を試みる）
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const cur = latestRef.current;
      if (cur.title !== savedRef.current.title || cur.body !== savedRef.current.body) {
        void flush();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flush]);

  // 本文の高さを内容に追従させる（Notion風にスクロールバーを出さない）
  const autosize = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(320, el.scrollHeight)}px`;
  }, []);
  useEffect(() => {
    autosize();
  }, [autosize, body]);

  const insertTemplate = () => {
    if (body.trim() && !window.confirm("本文が入力済みです。末尾にテンプレートを追加しますか？")) return;
    const now = new Date();
    const dateLabel = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
    const next = body.trim() ? `${body.replace(/\s+$/, "")}\n\n${minutesTemplate(dateLabel)}` : minutesTemplate(dateLabel);
    setBody(next);
    scheduleSave({ body: next });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          placeholder="無題"
          aria-label="ページタイトル"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold text-ink outline-none hover:border-black/10 focus:border-teal-primary focus:bg-white md:text-2xl"
        />
        <span className={`shrink-0 text-[11px] tabular-nums ${state === "error" ? "text-rose-600 font-semibold" : "text-ink/40"}`}>
          {SAVE_LABEL[state]}
        </span>
      </div>

      {kind === "minutes" && (
        <div className="mt-1.5 px-2">
          <button
            type="button"
            onClick={insertTemplate}
            className="inline-flex items-center gap-1 text-xs text-teal-deep hover:underline"
          >
            <ListPlus size={13} /> 議事録テンプレートを挿入
          </button>
        </div>
      )}

      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          scheduleSave({ body: e.target.value });
        }}
        onBlur={() => void flush()}
        placeholder={
          kind === "minutes"
            ? "ここに議事録を書くだけ。自動保存されます。下の「録音開始」を使えば、夜間に文字起こし・AI要約がこのページに入ります。"
            : "ここに書くだけ。自動保存されます。"
        }
        aria-label="本文"
        className="mt-2 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-7 text-ink outline-none hover:border-black/10 focus:border-teal-primary focus:bg-white"
      />
    </div>
  );
}
