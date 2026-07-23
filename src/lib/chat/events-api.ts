import { getChatAccessToken, CHAT_EVENTS_SCOPE } from "./client";

/**
 * Google Workspace Events API の購読管理（P3: リアクションイベント購読）。
 * リアクションは Bot のインタラクションイベントには含まれないため、
 * スペース単位で購読を作成し、Cloud Pub/Sub 経由で受信する。
 * 購読は有効期限があるため、cron で定期的に更新する。
 */

const EVENTS_API_BASE = "https://workspaceevents.googleapis.com/v1";
const REACTION_EVENT_TYPES = [
  "google.workspace.chat.reaction.v1.created",
  "google.workspace.chat.reaction.v1.deleted",
];

async function eventsApiFetch<T = any>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | null> {
  const token = await getChatAccessToken(CHAT_EVENTS_SCOPE);
  if (!token) return null;
  const res = await fetch(`${EVENTS_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Events API ${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface SubscriptionResult {
  name?: string;
  expireTime?: string;
}

/**
 * 指定スペースのリアクションイベント購読を作成。
 * pubsubTopic は "projects/<id>/topics/<name>" 形式。
 * 返り値は購読名と期限（LRO の場合は response 内）。
 */
export async function createReactionSubscription(
  spaceName: string,
  pubsubTopic: string,
): Promise<SubscriptionResult | null> {
  const body = {
    targetResource: `//chat.googleapis.com/${spaceName}`,
    eventTypes: REACTION_EVENT_TYPES,
    notificationEndpoint: { pubsubTopic },
    payloadOptions: { includeResource: true },
  };
  const res = await eventsApiFetch<any>("POST", `/subscriptions`, body);
  if (!res) return null;
  // 同期作成時は subscription、LRO 時は response に入る。
  const sub = res.response ?? res;
  return { name: sub?.name, expireTime: sub?.expireTime };
}

/** 既存購読を延長（ttl を再設定）。 */
export async function renewSubscription(
  subscriptionName: string,
  ttlSeconds = 86400,
): Promise<SubscriptionResult | null> {
  const res = await eventsApiFetch<any>(
    "PATCH",
    `/${subscriptionName}?updateMask=ttl`,
    { ttl: `${ttlSeconds}s` },
  );
  if (!res) return null;
  const sub = res.response ?? res;
  return { name: sub?.name, expireTime: sub?.expireTime };
}
