import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 稼働中のビルド情報を返す(認証不要・秘匿情報なし)。
 *
 * 「コードは直したのに画面が変わらない」ときに、デプロイが追いついているのか
 * コードの不具合なのかを切り分けるために使う。値はVercelが自動で入れる環境変数。
 * 公開リポジトリのコミットSHAとブランチ名のみで、資格情報は含めない。
 */
export function GET() {
  return NextResponse.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "local",
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
      env: process.env.VERCEL_ENV ?? "development",
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0]?.slice(0, 120) ?? null,
      now: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
