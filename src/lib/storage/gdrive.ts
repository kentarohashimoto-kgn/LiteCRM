/**
 * P1 Google Drive アダプタ(第1号プロバイダ)。
 * googleapis SDK は使わず REST を fetch で叩く(既存 gmail-api.ts と同方針)。
 * 認可はテナントの組織接続(oauth_org)。スコープ: drive.readonly
 * (OAuthクライアントは Gmail 連携と同じ GOOGLE_CLIENT_ID を使用)。
 */

import "server-only";
import { refreshAccessToken } from "@/lib/google-oauth";
import {
  registerProvider,
  type FileMeta,
  type LinkHealth,
  type StorageConnection,
  type StorageProviderAdapter,
} from "@/lib/storage/provider";

/**
 * カトルセ環境の既定カテゴリマップ(共有ドライブ再編 2026-07-25 実施記録)。
 * docs/DRIVE_REORG_RUNBOOK_2026-07.md §4b のフォルダIDと1:1。
 * 他テナントでは tenant_storage_connections.config.categoryFolders で上書きする。
 */
const DEFAULT_CATEGORY_FOLDERS: Record<string, string> = {
  "1T7PKT0UTk-_FrZGXi7D-0oJAAdKkPXSB": "提案書",
  "1s9SwmGsmP3-75PJLDz3cn5BOSudeZi1B": "企画書",
  "1CZrOV4JvmrQbISZmxIb9VB-phYJEDXTW": "研修資料",
  "1ODh5lXXBBZvrYOPjDnqr5zOKIAS9AtoQ": "技術資料",
  "1sQShNdr_ODbEw5xZgJ2sEwWsSC4mBZ8U": "営業ツール",
  "1axL2wyi6TFPtbMFOD_n3uh9j_KZpmYqR": "テンプレート",
  "1wI8AGkIjtQHPa174UmS09Vnk4iNeDjac": "契約書類",
  "1TxxEHBzpYVUcEJ7PXsMfoOucQUv6M6WL": "請求",
  "1q39kyzYoaEg4TT2VFqrVxpZUkPGSP1U_": "人事",
  // 共有ドライブ直下(602_CRM_案件)に置かれた案件フォルダは「案件」扱い
  "0AJ7lOEbLbfXGUk9PVA": "案件",
};

export const GDRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

/** Drive の各種URL/生IDから fileId を取り出す。 */
export function parseDriveFileId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // https://drive.google.com/file/d/<id>/view, docs.google.com/document|presentation|spreadsheets/d/<id>/edit
  const dMatch = s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];
  // https://drive.google.com/drive/folders/<id>
  const folderMatch = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  // open?id=<id> 形式
  const idParam = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (idParam) return idParam[1];
  // 生のID(URLでない場合のみ)
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

interface DriveFileResp {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  trashed?: boolean;
  parents?: string[];
  error?: { code?: number; message?: string };
}

async function driveGetFile(accessToken: string, fileId: string): Promise<{ status: number; body: DriveFileResp }> {
  const fields = "id,name,mimeType,size,webViewLink,headRevisionId,modifiedTime,trashed,parents";
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = (await res.json().catch(() => ({}))) as DriveFileResp;
  return { status: res.status, body };
}

/** 接続アカウントのメールアドレス(接続確認・表示用)。 */
export async function fetchDriveAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { user?: { emailAddress?: string } };
  return j.user?.emailAddress ?? null;
}

async function accessTokenOf(conn: StorageConnection): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const t = await refreshAccessToken(conn.refreshToken);
  if (!t.ok) return { ok: false, error: t.error };
  return { ok: true, token: t.accessToken };
}

const gdriveAdapter: StorageProviderAdapter = {
  kind: "gdrive",

  parseFileId: parseDriveFileId,

  async resolveFile(conn, externalId) {
    const tok = await accessTokenOf(conn);
    if (!tok.ok) return { ok: false, error: `Google認証エラー: ${tok.error}`, health: "forbidden" };
    const { status, body } = await driveGetFile(tok.token, externalId);
    if (status === 404) return { ok: false, error: "ファイルが見つかりません(削除済みの可能性)", health: "deleted" };
    if (status === 403 || status === 401) return { ok: false, error: "接続アカウントにこのファイルへのアクセス権がありません", health: "forbidden" };
    if (status !== 200 || !body.id) return { ok: false, error: body.error?.message || `Drive APIエラー(${status})`, health: "forbidden" };
    if (body.trashed) return { ok: false, error: "ファイルはゴミ箱にあります", health: "deleted" };
    const file: FileMeta = {
      externalId: body.id,
      title: body.name || "(無題)",
      mimeType: body.mimeType ?? null,
      sizeBytes: body.size ? Number(body.size) : null,
      webUrl: body.webViewLink ?? null,
      revision: body.headRevisionId || body.modifiedTime || null,
      modifiedTime: body.modifiedTime ?? null,
      parentId: body.parents?.[0] ?? null,
    };
    return { ok: true, file };
  },

  async checkHealth(conn, externalId): Promise<LinkHealth> {
    const tok = await accessTokenOf(conn);
    if (!tok.ok) return "forbidden";
    const { status, body } = await driveGetFile(tok.token, externalId);
    if (status === 404) return "deleted";
    if (status === 403 || status === 401) return "forbidden";
    if (status !== 200) return "forbidden";
    return body.trashed ? "deleted" : "ok";
  },

  inferCategory(conn, parentId) {
    if (!parentId) return null;
    const custom = (conn.config?.categoryFolders ?? {}) as Record<string, string>;
    return custom[parentId] ?? DEFAULT_CATEGORY_FOLDERS[parentId] ?? null;
  },
};

registerProvider(gdriveAdapter);

export { gdriveAdapter };
