/**
 * P1 統合ドキュメント基盤: StorageProvider アダプタ層。
 * アプリ本体はこのインターフェースにのみ依存し、プロバイダ固有実装
 * (Google Drive 等)は各アダプタ内に閉じる(SaaS展開時に差し替え可能)。
 * 設計: docs/DESIGN_DOCUMENT_STORAGE_AI_2026-07.md §2
 */

import "server-only";

export type LinkHealth = "ok" | "moved" | "forbidden" | "deleted";

export interface FileMeta {
  externalId: string;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webUrl: string | null;
  revision: string | null;
  modifiedTime: string | null;
  /** 直上の親フォルダID(カテゴリ自動判定に使用) */
  parentId: string | null;
}

export interface StorageConnection {
  id: string;
  tenantId: string;
  provider: string;
  /** 復号済みリフレッシュトークン等 */
  refreshToken: string;
  config: Record<string, unknown>;
}

export interface StorageProviderAdapter {
  readonly kind: string;
  /** 入力(URL/ID)からプロバイダ内のファイルIDを取り出す。解釈できなければ null。 */
  parseFileId(input: string): string | null;
  /** ファイルのメタデータを解決する。 */
  resolveFile(conn: StorageConnection, externalId: string): Promise<
    { ok: true; file: FileMeta } | { ok: false; error: string; health: LinkHealth }
  >;
  /** リンク健全性(存在・アクセス可否)を確認する。 */
  checkHealth(conn: StorageConnection, externalId: string): Promise<LinkHealth>;
  /** 親フォルダIDから資料カテゴリを判定する(不明なら null)。 */
  inferCategory(conn: StorageConnection, parentId: string | null): string | null;
}

const registry = new Map<string, StorageProviderAdapter>();

export function registerProvider(adapter: StorageProviderAdapter): void {
  registry.set(adapter.kind, adapter);
}

export function getProvider(kind: string): StorageProviderAdapter | null {
  return registry.get(kind) ?? null;
}
