/**
 * Google APIのエラー本文から「本当の原因」を見分ける（純関数・テスト対象）。
 *
 * GCPは「APIが無効」も「権限がない」も同じ403で返す。区別せずに
 * 「ユーザーと権限に追加してください」と案内すると、権限を付けても直らず
 * 利用者が詰まる。原因ごとに正しい対処を出し分けるためのヘルパー。
 */

/** GCPプロジェクトでAPI自体が無効化されているか（権限付与では直らないケース）。 */
export function isApiDisabled(body: string): boolean {
  return (
    /has not been used in project/i.test(body) ||
    /SERVICE_DISABLED/i.test(body) ||
    /accessNotConfigured/i.test(body) ||
    /it is disabled/i.test(body)
  );
}

/** エラー本文からGCPのプロジェクト識別子を拾う（有効化リンクを組み立てるため）。 */
export function extractProjectId(body: string): string | null {
  // 本文には "project=274438881688"（URL内）と "in project 274438881688"（文中）の
  // 両方の形が出うる。URL内の形を優先し、無ければ文中の形を拾う。
  return (
    body.match(/project[=/:]\s*([a-z0-9][a-z0-9-]{4,})/i)?.[1] ??
    body.match(/in project ([a-z0-9][a-z0-9-]{4,})/i)?.[1] ??
    null
  );
}
