import { cardMessage, isChatConfigured, sendChatMessage } from "./send";

/**
 * 案件コメントの Google Chat 通知（C-2連動）。
 *   ・メンションあり → メンションされた各ユーザーへ個別DM
 *   ・メンションなし → コメントフィード用スペースへ配信
 * フェイルセーフ: Chat未構成なら no-op。送信失敗は呼び出し側で握りつぶす前提。
 */

/** メンションなしコメントの配信先スペース（env で上書き可）。 */
const COMMENT_FEED_SPACE =
  process.env.GOOGLE_CHAT_COMMENT_SPACE ?? "spaces/AAQAIyCd7LY";

export interface CommentNotifyInput {
  tenantId: string;
  authorName: string;
  oppLabel: string; // 「取引先｜案件名」
  body: string;
  url: string; // 案件詳細への絶対URL
  /** メンション対象のCRMユーザーID（投稿者本人は除外済みであること） */
  mentionTargets: string[];
}

export async function notifyCommentToChat(input: CommentNotifyInput): Promise<void> {
  if (!isChatConfigured()) return;
  const excerpt = input.body.length > 300 ? `${input.body.slice(0, 300)}…` : input.body;

  if (input.mentionTargets.length > 0) {
    // メンションされた本人だけにDM（identity未登録の相手はsendChatMessage内で空振り→アプリ内通知のみ）
    const card = cardMessage({
      title: `💬 ${input.authorName} さんがあなたをメンション`,
      lines: [`<b>${input.oppLabel}</b>`, excerpt],
      buttonText: "案件を開く",
      buttonUrl: input.url,
    });
    for (const userId of input.mentionTargets) {
      await sendChatMessage({ type: "dm", tenantId: input.tenantId, userId }, card);
    }
    return;
  }

  // メンションなし: コメントフィードスペースへ
  const card = cardMessage({
    title: `💬 ${input.authorName} さんがコメント`,
    lines: [`<b>${input.oppLabel}</b>`, excerpt],
    buttonText: "案件を開く",
    buttonUrl: input.url,
  });
  await sendChatMessage({ type: "space", spaceName: COMMENT_FEED_SPACE }, card);
}
