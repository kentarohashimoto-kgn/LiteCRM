/** 履歴ペインの一覧をクライアント側で先に更新するための純関数。 */

import type { LabUiConversation } from "./ui-types";

/**
 * サーバーから来た一覧に、まだサーバーが知らない会話を重ねる。
 *
 * 送信した会話が履歴ペインに出るのを「生成が終わってサーバーを取り直すまで」待つと、
 * 画像生成のように1ターンが長いものでは、その間ずっと履歴に現れない。
 * そこで送信直後にクライアント側で差し込み、サーバーが追いついたら重複を落とす。
 */
export function mergeConversations(
  local: LabUiConversation[],
  server: LabUiConversation[],
): LabUiConversation[] {
  const known = new Set(server.map((c) => c.id));
  return [...local.filter((c) => !known.has(c.id)), ...server];
}

/**
 * 一覧の先頭へ差し込む。同じidがあれば置き換え、`replacesId` の仮エントリは取り除く
 * (送信直後は会話IDが無いので仮IDで並べ、サーバー確定後に本物へ差し替えるため)。
 */
export function upsertConversation(
  local: LabUiConversation[],
  conversation: LabUiConversation,
  replacesId?: string | null,
): LabUiConversation[] {
  const rest = local.filter((c) => c.id !== conversation.id && c.id !== replacesId);
  return [conversation, ...rest];
}
