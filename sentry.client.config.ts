// E-4 エラー監視(ブラウザ)。DSN未設定なら初期化しない(完全no-op)。
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // リプレイは重いため既定off(必要になったら有効化)
    integrations: [],
  });
}
