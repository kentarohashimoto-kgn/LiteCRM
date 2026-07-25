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

/**
 * P1.5でアップロード(書込)に対応したため drive フルスコープ。
 * readonly時代の接続では書込が403になるため、設定画面の「再接続」で取り直す
 * (書込可否は接続時に保存する config.scopes で判定する)。
 */
export const GDRIVE_SCOPES = "https://www.googleapis.com/auth/drive";
export const GDRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

/**
 * 種別→アップロード先フォルダの既定マップ(カトルセ環境)。
 * 「その他」は資料庫ドライブ直下。テナント毎に config.uploadFolders で上書き可能。
 */
const DEFAULT_UPLOAD_FOLDERS: Record<string, string> = {
  提案書: "1T7PKT0UTk-_FrZGXi7D-0oJAAdKkPXSB",
  企画書: "1s9SwmGsmP3-75PJLDz3cn5BOSudeZi1B",
  研修資料: "1CZrOV4JvmrQbISZmxIb9VB-phYJEDXTW",
  技術資料: "1ODh5lXXBBZvrYOPjDnqr5zOKIAS9AtoQ",
  営業ツール: "1sQShNdr_ODbEw5xZgJ2sEwWsSC4mBZ8U",
  テンプレート: "1axL2wyi6TFPtbMFOD_n3uh9j_KZpmYqR",
  契約書類: "1wI8AGkIjtQHPa174UmS09Vnk4iNeDjac",
  請求: "1TxxEHBzpYVUcEJ7PXsMfoOucQUv6M6WL",
  人事: "1q39kyzYoaEg4TT2VFqrVxpZUkPGSP1U_",
  その他: "0AAf9Tw3eZeIgUk9PVA", // 601_CRM_資料庫 直下
};

/** 種別からアップロード先フォルダIDを解決する。 */
export function resolveUploadFolder(conn: StorageConnection, category: string): string | null {
  const custom = (conn.config?.uploadFolders ?? {}) as Record<string, string>;
  return custom[category] ?? DEFAULT_UPLOAD_FOLDERS[category] ?? null;
}

/** P1.6 商談録音の保存先フォルダ(601_CRM_資料庫/90_商談録音)。config.recordingsFolder で上書き可。 */
const DEFAULT_RECORDINGS_FOLDER = "1kedHryueWdFSCCj1C1rXdq5cU5ogCpTM";
export function resolveRecordingsFolder(conn: StorageConnection): string {
  return String(conn.config?.recordingsFolder ?? DEFAULT_RECORDINGS_FOLDER);
}

/** P1.6 ファイル削除(30日保持期限切れの録音掃除・録音の手動削除に使用)。 */
export async function deleteDriveFile(conn: StorageConnection, fileId: string): Promise<{ ok: boolean; error?: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: tok.error };
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    { method: "DELETE", headers: { Authorization: `Bearer ${tok.token}` } },
  );
  if (res.status === 204 || res.status === 404) return { ok: true }; // 404=既に無い
  return { ok: false, error: `削除失敗(${res.status})` };
}

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

/**
 * P1.5 resumableアップロードセッションを開始し、ブラウザが直接PUTできるURLを返す。
 * Vercelのリクエストボディ上限(約4.5MB)を回避するため、ファイル本体はブラウザ→Google直送。
 * CORSのため Origin ヘッダにアプリのオリジンを渡す(返るセッションURLがそのオリジンを許可する)。
 */
export async function createResumableUploadSession(
  conn: StorageConnection,
  input: { fileName: string; mimeType: string; parentId: string },
): Promise<{ ok: true; sessionUrl: string } | { ok: false; error: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: `Google認証エラー: ${tok.error}` };
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok.token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType || "application/octet-stream",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name: input.fileName, parents: [input.parentId] }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason;
    if (res.status === 403 && (reason === "insufficientPermissions" || reason === "insufficientScopes" || reason === "forbidden")) {
      return { ok: false, error: "接続が読み取り専用です。設定画面からGoogleドライブを再接続してください(書込権限の取り直し)" };
    }
    return { ok: false, error: body.error?.message || `Drive APIエラー(${res.status})` };
  }
  const sessionUrl = res.headers.get("Location");
  if (!sessionUrl) return { ok: false, error: "アップロードセッションの開始に失敗しました" };
  return { ok: true, sessionUrl };
}

/** P1.5 静止点コピー用: ファイル本体をダウンロード(上限バイト保護つき)。 */
export async function downloadDriveFile(
  conn: StorageConnection,
  fileId: string,
  maxBytes: number,
): Promise<{ ok: true; data: Buffer; contentType: string | null } | { ok: false; error: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: tok.error };
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${tok.token}` } },
  );
  if (!res.ok) return { ok: false, error: `ダウンロード失敗(${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return { ok: false, error: `サイズ超過(${Math.round(buf.byteLength / 1024 / 1024)}MB > 上限${Math.round(maxBytes / 1024 / 1024)}MB)` };
  return { ok: true, data: buf, contentType: res.headers.get("content-type") };
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
