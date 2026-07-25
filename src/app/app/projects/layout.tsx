/**
 * 原価管理セグメントのレイアウト。既定スロット(children)に加えて、
 * スライドオーバー用の並列スロット(@detail)を重ねて描画する。
 * カレンダー/一覧から案件をクリックするとインターセプトルートが @detail を埋め、
 * 元の画面(children)はマウントされたまま＝タブ・スクロール・表示範囲が保持される。
 */
export default function ProjectsLayout({
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
