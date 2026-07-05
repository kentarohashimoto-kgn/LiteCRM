"use client";

/** ルートレイアウト自体が失敗した場合の最終フォールバック(html/bodyを自前で描画)。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f5f7f7" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a2b2b" }}>エラーが発生しました</h1>
          <p style={{ fontSize: 13, color: "#5a6b6b", marginTop: 8 }}>
            再読み込みしても解決しない場合は、時間をおいて再度お試しください。
          </p>
          {error.digest && <p style={{ fontSize: 11, color: "#9aa8a8", marginTop: 8 }}>エラーID: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 20px", borderRadius: 10, background: "#008C8C", color: "#fff", border: "none", cursor: "pointer", fontSize: 14 }}
          >
            再読み込み
          </button>
        </div>
      </body>
    </html>
  );
}
