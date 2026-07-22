/**
 * 案件セグメントのレイアウト。既定スロット(children)に加えて、
 * スライドオーバー用の並列スロット(@detail)を重ねて描画する。
 * 一覧から案件をクリックするとインターセプトルートが @detail を埋め、
 * 一覧(children)はマウントされたまま＝検索・フィルタ・スクロールが保持される。
 */
export default function OpportunitiesLayout({
  children,
  detail,
}: {
  children: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <>
      {children}
      {detail}
    </>
  );
}
