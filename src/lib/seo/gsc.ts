import "server-only";
import { GSC_SCOPE, getSeoAccessToken, classifyStatus, type ApiStatus } from "./google-sa";

/**
 * Google Search Console API クライアント（REST直叩き・SDK不使用）。
 *
 * 取得できるのは 表示回数 / クリック / CTR / 平均掲載順位。
 * 「どのクエリで表示され、どのページに着地したか」が分かる唯一の一次情報源であり、
 * 本エンジンの Plan 層の土台になる。
 *
 * 実務上の注意（設計書 §5.1）:
 *  - データは概ね 2〜3日遅れ。確定値を取るため D-3 以前を対象にする。
 *  - 1リクエスト最大25,000行。ページングは startRow で行う。
 *  - 検索ボリュームが小さいクエリは返らない（プライバシーしきい値）。
 *    「消えた＝順位が落ちた」ではないため、劣化検知では最低表示回数で足切りする。
 */

const API_BASE = "https://www.googleapis.com/webmasters/v3";

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * SAがアクセスできるプロパティ一覧。
 * 「接続診断」の中核 — GSCの登録形式（sc-domain: か URLプレフィックスか）と
 * 権限付与の成否が、これ1本で判明する。
 */
export async function listGscSites(): Promise<
  { ok: true; sites: GscSiteEntry[] } | { ok: false; status: ApiStatus; message: string }
> {
  const token = await getSeoAccessToken(GSC_SCOPE);
  if (!token) return { ok: false, status: "error", message: "サービスアカウントが未設定です。" };

  const res = await fetch(`${API_BASE}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return { ok: false, status: classifyStatus(res.status), message: await describeError(res) };
  }
  const data = (await res.json()) as { siteEntry?: GscSiteEntry[] };
  return { ok: true, sites: data.siteEntry ?? [] };
}

export interface SearchAnalyticsParams {
  siteUrl: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensions: Array<"date" | "page" | "query" | "device" | "country">;
  rowLimit?: number;
  startRow?: number;
}

/**
 * 検索アナリティクスを取得する。
 * dataState は既定の 'final'（確定値のみ）。速報値は日々変動し、
 * 効果検証の前後比較を壊すため使わない。
 */
export async function querySearchAnalytics(
  params: SearchAnalyticsParams,
): Promise<{ ok: true; rows: GscRow[] } | { ok: false; status: ApiStatus; message: string }> {
  const token = await getSeoAccessToken(GSC_SCOPE);
  if (!token) return { ok: false, status: "error", message: "サービスアカウントが未設定です。" };

  const url = `${API_BASE}/sites/${encodeURIComponent(params.siteUrl)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: params.dimensions,
      rowLimit: params.rowLimit ?? 5000,
      startRow: params.startRow ?? 0,
      type: "web",
      dataState: "final",
    }),
  });
  if (!res.ok) {
    return { ok: false, status: classifyStatus(res.status), message: await describeError(res) };
  }
  const data = (await res.json()) as { rows?: GscRow[] };
  return { ok: true, rows: data.rows ?? [] };
}

/** エラー本文を、画面にそのまま出せる日本語の説明に変換する。 */
async function describeError(res: Response): Promise<string> {
  const body = (await res.text()).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    return `権限がありません(${res.status})。Search Consoleの「ユーザーと権限」にサービスアカウントのメールアドレスを追加してください。 ${body}`;
  }
  if (res.status === 404) {
    return `プロパティが見つかりません(404)。GSCの登録形式（sc-domain: 形式かURLプレフィックス形式か）を接続診断で確認してください。 ${body}`;
  }
  if (res.status === 429) return `APIのレート制限に達しました(429)。時間をおいて再実行されます。 ${body}`;
  return `Search Console APIエラー(${res.status}): ${body}`;
}
