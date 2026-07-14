"use client";

import Script from "next/script";

/**
 * Cloudflare Turnstile（CAPTCHA）ウィジェット。
 * ログインフォーム送信時に hidden input `cf-turnstile-response` を自動付与する。
 * サイトキー未設定時はログインページ側でレンダリングしない（段階導入）。
 */
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  return (
    <div className="flex justify-center">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
    </div>
  );
}
