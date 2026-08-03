"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { mergeConversations, upsertConversation } from "@/lib/ai-lab/conversations";
import type { LabUiConversation } from "@/lib/ai-lab/ui-types";

/**
 * 履歴ペイン(レイアウト側)とチャット本体をつなぐ最小の共有状態。
 *
 * 会話の作成はチャット本体が握っているのに、一覧を描いているのは外側。
 * サーバーの取り直しを待つと反映が遅れるので、ここを経由して先に見せる。
 */
interface LabChatContextValue {
  conversations: LabUiConversation[];
  activeId: string | null;
  /** 会話を一覧の先頭へ出す。`replacesId` を渡すと仮エントリを置き換える。 */
  showConversation: (conversation: LabUiConversation, replacesId?: string | null) => void;
  /** 「新しいチャット」が押された回数。チャット本体はこれを見て自分を初期化する。 */
  newChatToken: number;
  startNewChat: () => void;
}

const LabChatContext = createContext<LabChatContextValue | null>(null);

export function useLabChat(): LabChatContextValue {
  const ctx = useContext(LabChatContext);
  if (!ctx) throw new Error("LabChatProvider の外で useLabChat が呼ばれました");
  return ctx;
}

export function LabChatProvider({
  conversations: serverConversations,
  activeId: serverActiveId,
  children,
}: {
  conversations: LabUiConversation[];
  activeId: string | null;
  children: React.ReactNode;
}) {
  // サーバーがまだ知らない会話だけを持つ。同じidが返ってきたら不要になる。
  const [local, setLocal] = useState<LabUiConversation[]>([]);
  // null は「上書きなし(サーバーの値を使う)」、{id:null} は「新規チャットなので選択なし」。
  const [activeOverride, setActiveOverride] = useState<{ id: string | null } | null>(null);
  const [newChatToken, setNewChatToken] = useState(0);

  const conversations = useMemo(
    () => mergeConversations(local, serverConversations),
    [local, serverConversations],
  );

  const showConversation = useCallback((conversation: LabUiConversation, replacesId?: string | null) => {
    setLocal((prev) => upsertConversation(prev, conversation, replacesId));
    setActiveOverride({ id: conversation.id });
  }, []);

  const startNewChat = useCallback(() => {
    setActiveOverride({ id: null });
    setNewChatToken((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      conversations,
      activeId: activeOverride ? activeOverride.id : serverActiveId,
      showConversation,
      newChatToken,
      startNewChat,
    }),
    [conversations, activeOverride, serverActiveId, showConversation, newChatToken, startNewChat],
  );

  return <LabChatContext.Provider value={value}>{children}</LabChatContext.Provider>;
}
