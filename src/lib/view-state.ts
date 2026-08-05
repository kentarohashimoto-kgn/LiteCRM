/**
 * 画面の表示状態（タブ・表示形式・表示中の週・絞り込み）をタブセッションに保持するための小道具。
 *
 * 案件ページはスライドオーバーで詳細を開くため通常は再マウントされないが、
 * リロード・別画面からの復帰・フルページ経由の戻る操作では再マウントされ、
 * 既定タブ（案件一覧）に戻ってしまう。カレンダーを常用する運用では毎回
 * 「カレンダー → 週 → 当該週」を選び直す必要があり、実務上の手戻りが大きい。
 * sessionStorage に保存して復元することで、同じタブで作業を続ける限り
 * 開いていた画面がそのまま戻る。
 *
 * sessionStorage を使うのは、ユーザー・テナントをまたいで残らない（タブを閉じれば消える）ため。
 */

/** 保存された表示状態を読む。SSR・プライベートモード等で失敗したら null。 */
export function readViewState<T>(key: string): Partial<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<T>;
  } catch {
    return null;
  }
}

/** 表示状態を保存する。失敗しても画面の動作には影響させない。 */
export function writeViewState<T extends object>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できなくても表示は継続する */
  }
}
