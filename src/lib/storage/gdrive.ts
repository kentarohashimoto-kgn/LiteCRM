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

/**
 * P2 権限監査の対象共有ドライブ(カトルセ環境の既定)。
 * config.auditDrives で上書き可(他テナント/SaaS向け)。boIsolated=営業・外部を入れてはいけないドライブ。
 */
export interface AuditDrive { id: string; name: string; boIsolated: boolean; scanFolders: boolean }
const DEFAULT_AUDIT_DRIVES: AuditDrive[] = [
  { id: "0AAf9Tw3eZeIgUk9PVA", name: "601_CRM_資料庫", boIsolated: false, scanFolders: false },
  { id: "0AJ7lOEbLbfXGUk9PVA", name: "602_CRM_案件", boIsolated: false, scanFolders: true },
  { id: "0AAuIlBViK7PRUk9PVA", name: "603_CRM_BO", boIsolated: true, scanFolders: false },
];
export function resolveAuditDrives(conn: StorageConnection): AuditDrive[] {
  const custom = conn.config?.auditDrives as AuditDrive[] | undefined;
  return Array.isArray(custom) && custom.length > 0 ? custom : DEFAULT_AUDIT_DRIVES;
}

/** P1.6 商談録音の保存先フォルダ(601_CRM_資料庫/90_商談録音)。config.recordingsFolder で上書き可。 */
const DEFAULT_RECORDINGS_FOLDER = "1kedHryueWdFSCCj1C1rXdq5cU5ogCpTM";
export function resolveRecordingsFolder(conn: StorageConnection): string {
  return String(conn.config?.recordingsFolder ?? DEFAULT_RECORDINGS_FOLDER);
}

/** P2 フォルダ直下の子(ファイル/フォルダ)を列挙する。 */
export async function listFolderChildren(
  conn: StorageConnection,
  folderId: string,
  limit = 200,
): Promise<{ ok: true; files: FileMeta[] } | { ok: false; error: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: tok.error };
  const fields = "files(id,name,mimeType,size,webViewLink,headRevisionId,modifiedTime,parents)";
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields,
    pageSize: String(Math.min(1000, limit)),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    corpora: "allDrives",
    orderBy: "modifiedTime desc",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${tok.token}` },
  });
  if (!res.ok) return { ok: false, error: `一覧取得に失敗(${res.status})` };
  const body = (await res.json()) as { files?: DriveFileResp[] };
  const files = (body.files ?? []).map((f) => ({
    externalId: f.id ?? "",
    title: f.name || "(無題)",
    mimeType: f.mimeType ?? null,
    sizeBytes: f.size ? Number(f.size) : null,
    webUrl: f.webViewLink ?? null,
    revision: f.headRevisionId || f.modifiedTime || null,
    modifiedTime: f.modifiedTime ?? null,
    parentId: f.parents?.[0] ?? null,
  }));
  return { ok: true, files };
}

export interface DrivePermission {
  permissionId: string;
  granteeType: string;   // user | group | domain | anyone
  email: string | null;
  role: string;
  deleted: boolean;
}

/** P2 共有ドライブ/フォルダの権限一覧(監査用)。 */
export async function listPermissions(
  conn: StorageConnection,
  fileOrDriveId: string,
): Promise<{ ok: true; permissions: DrivePermission[] } | { ok: false; error: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: tok.error };
  const params = new URLSearchParams({
    fields: "permissions(id,type,emailAddress,domain,role,deleted)",
    pageSize: "100",
    supportsAllDrives: "true",
    useDomainAdminAccess: "false",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileOrDriveId)}/permissions?${params.toString()}`,
    { headers: { Authorization: `Bearer ${tok.token}` } },
  );
  if (!res.ok) return { ok: false, error: `権限取得に失敗(${res.status})` };
  const body = (await res.json()) as {
    permissions?: { id?: string; type?: string; emailAddress?: string; domain?: string; role?: string; deleted?: boolean }[];
  };
  const permissions = (body.permissions ?? []).map((p) => ({
    permissionId: p.id ?? "",
    granteeType: p.type ?? "user",
    email: p.emailAddress ?? p.domain ?? null,
    role: p.role ?? "",
    deleted: !!p.deleted,
  }));
  return { ok: true, permissions };
}

/**
 * P4 本文テキスト抽出(AI学習インデックス用)。
 *  - Google形式(Doc/Slide/Sheet) → files.export でそのままテキスト化
 *  - Office/PDF → 一時的にGoogle形式へ変換コピー(PDFはOCRも効く)→ export → 一時ファイル削除
 * 新規の外部依存を増やさず、Drive APIだけで完結させる方針。
 */
const NATIVE_EXPORT: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const CONVERT_TARGET: Record<string, string> = {
  "application/pdf": "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.google-apps.document",
  "application/msword": "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "application/vnd.google-apps.presentation",
  "application/vnd.ms-powerpoint": "application/vnd.google-apps.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "application/vnd.google-apps.spreadsheet",
  "text/plain": "",   // 変換不要(直接DL)
  "text/markdown": "",
  "text/csv": "",
};

/** 抽出できるMIMEかどうか(バッチのスキップ判定に使用)。 */
export function isExtractableMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType in NATIVE_EXPORT || mimeType in CONVERT_TARGET;
}

export async function extractText(
  conn: StorageConnection,
  fileId: string,
  mimeType: string | null,
  maxChars = 200_000,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const tok = await accessTokenOf(conn);
  if (!tok.ok) return { ok: false, error: tok.error };
  const auth = { Authorization: `Bearer ${tok.token}` };
  const mime = mimeType ?? "";

  const exportAs = async (id: string, target: string): Promise<string | null> => {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(target)}`,
      { headers: auth },
    );
    if (!res.ok) return null;
    return (await res.text()).slice(0, maxChars);
  };

  // ① Google形式はそのままエクスポート
  if (mime in NATIVE_EXPORT) {
    const text = await exportAs(fileId, NATIVE_EXPORT[mime]);
    return text === null ? { ok: false, error: "エクスポートに失敗しました" } : { ok: true, text };
  }

  // ② プレーンテキスト系は直接ダウンロード
  if (mime in CONVERT_TARGET && CONVERT_TARGET[mime] === "") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: auth },
    );
    if (!res.ok) return { ok: false, error: `ダウンロード失敗(${res.status})` };
    return { ok: true, text: (await res.text()).slice(0, maxChars) };
  }

  // ③ Office/PDF は一時的にGoogle形式へ変換してからエクスポート
  const target = CONVERT_TARGET[mime];
  if (!target) return { ok: false, error: `未対応の形式(${mime})` };
  const copyRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: target, name: `__tmp_index_${fileId}` }),
    },
  );
  if (!copyRes.ok) {
    const body = (await copyRes.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: `変換に失敗(${copyRes.status}): ${body.error?.message ?? ""}`.slice(0, 200) };
  }
  const tmpId = ((await copyRes.json()) as { id?: string }).id;
  if (!tmpId) return { ok: false, error: "変換結果の取得に失敗しました" };
  try {
    const text = await exportAs(tmpId, target === "application/vnd.google-apps.spreadsheet" ? "text/csv" : "text/plain");
    return text === null ? { ok: false, error: "変換後のエクスポートに失敗しました" } : { ok: true, text };
  } finally {
    // 一時ファイルは必ず掃除する(ドライブを汚さない)
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(tmpId)}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: auth,
    }).catch(() => undefined);
  }
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
