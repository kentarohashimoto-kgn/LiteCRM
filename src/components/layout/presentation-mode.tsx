import { Presentation, RotateCcw, LogOut } from "lucide-react";
import { enterPresentationMode, exitPresentationMode, resetDemoData } from "@/server/actions/presentation";

/**
 * トップバーの「プレゼンモード開始」ボタン。通常モード時のみ表示。
 * 押すとデモテナントへ切り替わり、全画面がダミーデータになる。
 */
export function PresentationToggleButton() {
  return (
    <form action={enterPresentationMode}>
      <button
        type="submit"
        title="プレゼンモード: 実データを隠しダミーデータで実演します"
        className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
      >
        <Presentation size={14} />
        <span className="hidden sm:inline">プレゼン</span>
      </button>
    </form>
  );
}

/**
 * プレゼンモード中に全画面上部へ固定表示する警告バナー。
 * 「今ダミーデータを見せている」ことを常時明示し、実データでの誤プレゼン/
 * デモのままの誤操作の両方を防ぐ。デモ初期化・通常復帰の操作もここに集約。
 */
export function PresentationBanner() {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-violet-600 px-3 py-1.5 text-white md:px-6">
      <div className="flex items-center gap-2 text-xs font-semibold md:text-sm">
        <Presentation size={16} />
        <span>プレゼンモード</span>
        <span className="hidden font-normal text-violet-100 sm:inline">
          — 表示中のデータはすべてダミーです（実データではありません）
        </span>
      </div>
      <div className="flex items-center gap-2">
        <form action={resetDemoData}>
          <button
            type="submit"
            title="デモデータを初期状態へ戻す(プレゼン中の編集を破棄)"
            className="flex items-center gap-1 rounded-full bg-violet-500/60 px-2.5 py-1 text-xs font-semibold hover:bg-violet-500"
          >
            <RotateCcw size={13} />
            <span className="hidden sm:inline">デモを初期化</span>
          </button>
        </form>
        <form action={exitPresentationMode}>
          <button
            type="submit"
            title="通常モード(実データ)へ戻る"
            className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
          >
            <LogOut size={13} />
            <span>通常モードへ</span>
          </button>
        </form>
      </div>
    </div>
  );
}
