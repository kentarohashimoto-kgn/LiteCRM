import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // クライアントのRouter Cacheを延長し、再訪問(メニュー往復)を即時表示にする。
    // 書き込み時は server action の revalidate で無効化されるため、受動的な遷移のみ対象。
    staleTimes: {
      dynamic: 180, // 動的ページを180秒キャッシュ(従来は実質0〜30秒)
      static: 300,
    },
    // instrumentation.ts (Sentry初期化) を有効化
    instrumentationHook: true,
    // C-3 ファイル添付: Server Action経由のアップロード上限(既定1MB)を引き上げ
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // セキュリティレスポンスヘッダ(包括レビュー2026-07-26 P3-e)。
  // クリックジャッキング・リファラ漏れ・MIMEスニッフィング等の基本防御。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

// E-4 エラー監視: NEXT_PUBLIC_SENTRY_DSN 未設定なら Sentry.init は走らず no-op。
// ソースマップのアップロードは SENTRY_AUTH_TOKEN があるときのみ。
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
