import "server-only";
import { GA4_SCOPE, getSeoAccessToken, classifyStatus, type ApiStatus } from "./google-sa";

/**
 * GA4 Data API クライアント（REST直叩き・SDK不使用）。
 *
 * GSCが「検索結果での見え方」を教えるのに対し、GA4は「来訪後の行動」を教える。
 * 本エンジンでは KPIツリーの セッション / エンゲージメント の段を埋めるために使う。
 *
 * 注意: GSCのクリック数とGA4のセッション数は必ずしも一致しない
 * （計測方法が違う・タグの取りこぼし・同一セッション内の複数クリック）。
 * そのため両者を突き合わせず、それぞれの段として並べて保持する。
 */

const API_BASE = "https://analyticsdata.googleapis.com/v1beta";

export interface Ga4DailyRow {
  date: string; // YYYY-MM-DD
  pagePath: string;
  sessions: number;
  engagedSessions: number;
  userEngagementSec: number;
}

interface Ga4Response {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

/**
 * 接続診断: プロパティにアクセスできるかを最小コストで確認する。
 * 1日分のセッション数だけを取りに行き、成否とサンプル値を返す。
 */
export async function checkGa4Access(
  propertyId: string,
): Promise<{ ok: true; sessions: number } | { ok: false; status: ApiStatus; message: string }> {
  const token = await getSeoAccessToken(GA4_SCOPE);
  if (!token) return { ok: false, status: "error", message: "サービスアカウントが未設定です。" };

  const res = await fetch(`${API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
      metrics: [{ name: "sessions" }],
    }),
  });
  if (!res.ok) return { ok: false, status: classifyStatus(res.status), message: await describeError(res) };
  const data = (await res.json()) as Ga4Response;
  const sessions = Number(data.rows?.[0]?.metricValues?.[0]?.value ?? 0);
  return { ok: true, sessions };
}

/**
 * 日付×ページパス別の セッション / エンゲージメント を取得する。
 * オーガニック検索に絞る（sessionDefaultChannelGroup = 'Organic Search'）。
 */
export async function fetchGa4DailyPages(
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 5000,
): Promise<{ ok: true; rows: Ga4DailyRow[] } | { ok: false; status: ApiStatus; message: string }> {
  const token = await getSeoAccessToken(GA4_SCOPE);
  if (!token) return { ok: false, status: "error", message: "サービスアカウントが未設定です。" };

  const res = await fetch(`${API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "userEngagementDuration" }],
      dimensionFilter: {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: { matchType: "EXACT", value: "Organic Search" },
        },
      },
      limit,
    }),
  });
  if (!res.ok) return { ok: false, status: classifyStatus(res.status), message: await describeError(res) };

  const data = (await res.json()) as Ga4Response;
  const rows: Ga4DailyRow[] = [];
  for (const r of data.rows ?? []) {
    const raw = r.dimensionValues?.[0]?.value ?? ""; // GA4は YYYYMMDD 形式
    if (raw.length !== 8) continue;
    rows.push({
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      pagePath: r.dimensionValues?.[1]?.value ?? "/",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      engagedSessions: Number(r.metricValues?.[1]?.value ?? 0),
      userEngagementSec: Number(r.metricValues?.[2]?.value ?? 0),
    });
  }
  return { ok: true, rows };
}

async function describeError(res: Response): Promise<string> {
  const body = (await res.text()).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    return `権限がありません(${res.status})。GA4の「プロパティのアクセス管理」にサービスアカウントのメールアドレスを閲覧者として追加してください。 ${body}`;
  }
  if (res.status === 404) {
    return `プロパティが見つかりません(404)。GA4のプロパティID（数字）が正しいか確認してください。 ${body}`;
  }
  return `GA4 Data APIエラー(${res.status}): ${body}`;
}
