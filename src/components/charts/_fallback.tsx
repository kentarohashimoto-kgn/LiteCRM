/**
 * チャート遅延ロード中のスケルトン。recharts(重量依存)を初回バンドルから外し、
 * ページ描画後にクライアントで読み込む間のプレースホルダ。
 */
export function ChartFallback({ h = 288 }: { h?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-lg bg-mist-soft/50"
      style={{ height: h }}
      aria-hidden
    />
  );
}
