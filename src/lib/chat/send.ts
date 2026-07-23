import { createMessage, isChatConfigured, type ChatMessagePayload } from "./client";
import { resolveTargetSpaces, type ChatTarget } from "./targets";

/**
 * Google Chat 送信の高レベルAPI（P1）。
 *
 * 設計上のフェイルセーフ: GOOGLE_CHAT_SA_CREDENTIALS 未設定なら完全 no-op
 * （Slack/メールと同様、既存機能に一切影響を与えない）。
 * 各 Space への送信は best-effort（1件失敗しても他は続行）。
 */

export interface SendResult {
  ok: boolean;
  sent: number;
  failed: number;
  skipped?: string;
}

/** ターゲット（DM/Space/エンティティ）へメッセージを送信。 */
export async function sendChatMessage(
  target: ChatTarget,
  payload: ChatMessagePayload,
): Promise<SendResult> {
  if (!isChatConfigured()) {
    return { ok: true, sent: 0, failed: 0, skipped: "GOOGLE_CHAT_SA_CREDENTIALS not configured" };
  }

  let spaces: string[];
  try {
    spaces = await resolveTargetSpaces(target);
  } catch (e) {
    return { ok: false, sent: 0, failed: 0, skipped: `resolve failed: ${(e as Error).message}` };
  }
  if (spaces.length === 0) {
    return { ok: true, sent: 0, failed: 0, skipped: "no target space resolved" };
  }

  let sent = 0;
  let failed = 0;
  for (const space of spaces) {
    try {
      await createMessage(space, payload);
      sent += 1;
    } catch {
      // 個別送信の失敗は握りつぶし、他Spaceへの配信を継続する。
      failed += 1;
    }
  }
  return { ok: failed === 0, sent, failed };
}

export type { ChatTarget } from "./targets";
export type { ChatMessagePayload } from "./client";
export { textMessage, cardMessage } from "./cards";
export { isChatConfigured } from "./client";
