"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUp, Paperclip, Square, X } from "lucide-react";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/ai-lab/attachments";
import { labErrorMessage } from "@/lib/ai-lab/limits";
import { conversationTitleFrom } from "@/lib/ai-lab/validate";
import { cn } from "@/lib/utils";
import type {
  LabPendingAttachment,
  LabUiFile,
  LabUiMessage,
  LabUiModel,
  LabUiPreset,
} from "@/lib/ai-lab/ui-types";
import { useLabChat } from "./lab-chat-context";
import { MessageBubble } from "./message-bubble";

interface Props {
  slug: string;
  companyName: string;
  conversationId: string | null;
  initialMessages: LabUiMessage[];
  models: LabUiModel[];
  defaultModel: string | null;
  /** 新規会話で選べるプリセット。 */
  presets: LabUiPreset[];
  /** 既存会話に固定されているプリセット(あれば)。 */
  activePreset: LabUiPreset | null;
}

function tempId(): string {
  return `tmp-${Math.random().toString(36).slice(2)}`;
}

export function ChatClient({
  slug,
  companyName,
  conversationId,
  initialMessages,
  models,
  defaultModel,
  presets,
  activePreset,
}: Props) {
  const router = useRouter();
  const { showConversation, newChatToken } = useLabChat();
  const [convId, setConvId] = useState<string | null>(conversationId);
  const [messages, setMessages] = useState<LabUiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(activePreset?.id ?? null);
  const [pending, setPending] = useState<LabPendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // プリセットがモデルを固定していればそれを使う。していなければ会社の既定モデル。
  const preset = activePreset ?? presets.find((p) => p.id === presetId) ?? null;
  const lockedModel = preset?.modelKey ?? null;
  const [model, setModel] = useState<string>(defaultModel ?? models[0]?.key ?? "");
  const effectiveModel = lockedModel ?? model;
  const currentModel = models.find((m) => m.key === effectiveModel) ?? models[0] ?? null;

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 会話IDは非同期処理の途中でも正しい値を見たいので、stateとは別にrefでも持つ。
  const convIdRef = useRef<string | null>(conversationId);
  /** サーバー確定前に履歴ペインへ出した仮エントリのID。 */
  const optimisticIdRef = useRef<string | null>(null);
  const newChatTokenRef = useRef(newChatToken);
  newChatTokenRef.current = newChatToken;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // 「新しいチャット」はルーターの現在地がずれていても効いてほしいので、
  // ナビゲーションに頼らずこの場で初期状態へ戻す。
  const seenNewChatToken = useRef(newChatToken);
  useEffect(() => {
    if (seenNewChatToken.current === newChatToken) return;
    seenNewChatToken.current = newChatToken;
    abortRef.current?.abort();
    abortRef.current = null;
    convIdRef.current = null;
    optimisticIdRef.current = null;
    setConvId(null);
    setMessages([]);
    setInput("");
    setPending([]);
    setError(null);
    setPresetId(null);
    setStreaming(false);
  }, [newChatToken]);

  const patchLast = useCallback((patch: Partial<LabUiMessage>) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return next;
    });
  }, []);

  const appendDelta = useCallback((delta: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, content: last.content + delta };
      return next;
    });
  }, []);

  /**
   * 新規会話ができたらURLだけ差し替える(ナビゲーションさせないので入力中の状態が消えない)。
   * あわせて履歴ペインの仮エントリを本物のIDへ差し替える。
   */
  const adoptConversation = useCallback(
    (id: string, title?: string) => {
      if (convIdRef.current) return;
      convIdRef.current = id;
      setConvId(id);
      window.history.replaceState(null, "", `/lab/${slug}/chat/${id}`);
      showConversation(
        { id, title: title || "新しいチャット", updatedAt: new Date().toISOString() },
        optimisticIdRef.current,
      );
      optimisticIdRef.current = null;
    },
    [slug, showConversation],
  );

  /** ファイル選択時にすぐアップロードして、送信時はIDだけ渡す(送信操作を軽く保つ)。 */
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

  async function sendImage(body: Record<string, unknown>, isCurrent: () => boolean) {
    const res = await fetch("/api/lab/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      conversationId?: string;
      title?: string;
      images?: string[];
    };
    // 待っている間に「新しいチャット」で画面が切り替わっていたら、もう書き込まない。
    if (!isCurrent()) return;
    if (!res.ok || json.error) {
      patchLast({ errorCode: json.error ?? "provider_error" });
      setError(labErrorMessage(json.error));
      return;
    }
    if (json.conversationId) adoptConversation(json.conversationId, json.title);
    patchLast({ content: "（画像を生成しました）", images: json.images ?? [] });
  }

  async function sendText(body: Record<string, unknown>, signal: AbortSignal, isCurrent: () => boolean) {
    const res = await fetch("/api/lab/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!isCurrent()) return;
      patchLast({ errorCode: json.error ?? "provider_error" });
      setError(labErrorMessage(json.error));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let event: {
          conversationId?: string;
          title?: string;
          delta?: string;
          done?: boolean;
          error?: string;
          files?: LabUiFile[];
        };
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue; // 壊れた行は捨てて受信を続ける
        }
        // 「新しいチャット」で画面が切り替わったら、以降の断片は捨てる。
        if (!isCurrent()) return;
        if (event.conversationId) adoptConversation(event.conversationId, event.title);
        if (event.delta) appendDelta(event.delta);
        if (event.files?.length) patchLast({ files: event.files });
        if (event.error) {
          if (event.error === "aborted") patchLast({ errorCode: "aborted" });
          else {
            patchLast({ errorCode: event.error });
            setError(labErrorMessage(event.error));
          }
        }
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming || !currentModel) return;

    setError(null);
    setInput("");
    // 画像生成は添付を受け取らない。ここで消すと、アップロード済みのファイルが
    // 送られもせず入力欄から消えるだけになるので、そのまま預かっておく。
    const usesAttachments = currentModel.kind !== "image";
    const sentAttachments = usesAttachments ? pending : [];
    if (usesAttachments) setPending([]);

    // 会話IDが決まるのは応答が返ってから。待たずに履歴ペインへ出しておき、
    // サーバー確定時に本物のIDへ差し替える(タイトルの決め方はサーバーと同じ関数)。
    if (!convIdRef.current) {
      const placeholderId = tempId();
      optimisticIdRef.current = placeholderId;
      showConversation({
        id: placeholderId,
        title: conversationTitleFrom(text),
        updatedAt: new Date().toISOString(),
      });
    }

    setMessages((prev) => [
      ...prev,
      {
        id: tempId(),
        role: "user",
        content: text,
        modelKey: currentModel.key,
        images: [],
        // 送信直後は署名URLが無いので、確定後の router.refresh() で本来の表示に置き換わる。
        attachments: sentAttachments.map((a) => ({ id: a.id, fileName: a.fileName, mime: a.mime, url: "" })),
        files: [],
        errorCode: null,
      },
      {
        id: tempId(),
        role: "assistant",
        content: "",
        modelKey: currentModel.key,
        images: [],
        attachments: [],
        files: [],
        errorCode: null,
      },
    ]);
    setStreaming(true);

    const body = {
      slug,
      conversationId: convId,
      presetId: convId ? null : presetId,
      modelKey: currentModel.key,
      message: text,
      attachmentIds: sentAttachments.map((a) => a.id),
    };

    const controller = new AbortController();
    abortRef.current = controller;
    // 送信中に「新しいチャット」へ切り替わったら、この送信の結果は破棄する。
    const tokenAtSend = newChatTokenRef.current;
    const isCurrent = () => newChatTokenRef.current === tokenAtSend;
    try {
      if (currentModel.kind === "image") await sendImage(body, isCurrent);
      else await sendText(body, controller.signal, isCurrent);
    } catch (e) {
      if (!isCurrent()) return;
      // 停止ボタンによる中断は失敗として扱わない(サーバー側も途中までを保存している)。
      if ((e as Error)?.name === "AbortError") patchLast({ errorCode: "aborted" });
      else {
        patchLast({ errorCode: "provider_error" });
        setError(labErrorMessage("provider_error"));
      }
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setStreaming(false);
      }
      // 履歴一覧(タイトル・並び順)をサーバーから取り直す。入力中の状態は保持される。
      router.refresh();
    }
  }

  const isNewChat = !convId && messages.length === 0;

  /**
   * 添付が使えない理由。使えるときは null。
   *
   * 画像生成はプロンプトから作るだけで入力ファイルを受け取らないため添付できない。
   * ただしボタンを disabled にするだけだと、受講者からは「押しても何も起きない」
   * としか見えない(disabled 要素は hover を出さないので title も出ない)ので、
   * 理由を文言として持ち、入力欄の下に常時表示する。
   */
  const attachDisabledReason =
    currentModel?.kind === "image"
      ? "画像生成モデルではファイルを添付できません。添付を使うときは、上のメニューでモデルを Claude に切り替えてください。"
      : null;

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="card card-pad max-w-md text-center">
          <AlertCircle className="mx-auto mb-2 text-accent-orange" />
          <p className="text-sm font-semibold text-ink">利用できるモデルがありません</p>
          <p className="mt-1 text-xs text-ink/60">運営にお問い合わせください。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 上部: モデル選択(＋新規会話ならプリセット選択) */}
      <div className="border-b border-black/[0.06] bg-white/70 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-ink/50">モデル</label>
          <select
            value={effectiveModel}
            onChange={(e) => setModel(e.target.value)}
            disabled={Boolean(lockedModel)}
            className="input w-auto py-1.5 text-sm disabled:bg-mist-soft disabled:text-ink/60"
          >
            {models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          {lockedModel && <span className="text-[11px] text-ink/45">このチャットはモデル固定です</span>}
          {!lockedModel && currentModel && (
            <span className="hidden text-[11px] text-ink/45 sm:inline">{currentModel.hint}</span>
          )}

          {isNewChat && presets.length > 0 && (
            <>
              <label className="ml-auto text-xs font-semibold text-ink/50">プリセット</label>
              <select
                value={presetId ?? ""}
                onChange={(e) => setPresetId(e.target.value || null)}
                className="input w-auto py-1.5 text-sm"
              >
                <option value="">標準（プリセットなし）</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {!isNewChat && preset && (
            <span className="ml-auto pill bg-teal-light text-teal-deep">{preset.name}</span>
          )}
        </div>
      </div>

      {/* 本文 */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="pt-10 text-center">
              <p className="text-lg font-bold text-ink">{companyName} 生成AI体験環境</p>
              <p className="mt-2 text-sm text-ink/55">
                聞きたいことを入力してください。モデルは上のメニューから切り替えられます。
              </p>
              {presetId && (
                <p className="mt-2 text-xs text-teal-deep">
                  プリセット「{presets.find((p) => p.id === presetId)?.name}」を使用します
                </p>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 入力 */}
      <div className="border-t border-black/[0.06] bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {error && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pending.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-black/10 bg-mist-soft px-2 py-1 text-xs"
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

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv"
              className="hidden"
              onChange={(e) => void uploadFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || streaming || attachDisabledReason !== null}
              className="btn-ghost h-[44px] px-3 disabled:cursor-not-allowed"
              title={attachDisabledReason ?? "PDF・画像・テキストを添付"}
              aria-label={attachDisabledReason ?? "ファイルを添付"}
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enterで送信 / Shift+Enterで改行。IME変換中のEnterは送信しない。
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={
                currentModel?.kind === "image" ? "作りたい画像を説明してください" : "メッセージを入力（Shift+Enterで改行）"
              }
              className="input max-h-40 min-h-[44px] flex-1 resize-y py-2.5"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="btn-ghost h-[44px] px-3"
                aria-label="生成を停止"
              >
                <Square size={16} />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim()}
                className="btn-primary h-[44px] px-3"
                aria-label="送信"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
          {/*
            添付ボタンを disabled にすると、ブラウザは hover イベントを出さないので
            title のツールチップが表示されない。理由はここに常時出す。
          */}
          <p
            className={cn(
              "mt-1.5 text-[11px] text-legible",
              attachDisabledReason && !uploading ? "text-accent-orange" : "text-ink/35",
            )}
          >
            {uploading
              ? "ファイルをアップロード中です…"
              : (attachDisabledReason ??
                "PDF・画像・テキストを添付できます。Excel などのファイル作成も依頼できます。AIの回答には誤りが含まれることがあります。")}
          </p>
        </div>
      </div>
    </div>
  );
}
