"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Maximize2 } from "lucide-react";

const STORE_KEY = "projects-pane-back";

/**
 * 原価管理の上に重ねるスライドオーバー。右側に画面幅の約2/3で開き、
 * カレンダー/一覧に留まったまま案件詳細を確認・更新できる。
 *  - バックドロップは張らない → 左に残る画面をそのままクリックして次の案件へ切り替えられる。
 *  - ✕ / ESC で元のタブ(カレンダー or 一覧)へ戻る。保存リダイレクト後も戻り先を保持する。
 *  - 「全画面」で従来のフルページを別タブで開ける。
 */
export function ProjectPane({ oppId, backHref, children }: { oppId: string; backHref: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [shown, setShown] = useState(false);

  // 開いた時の戻り先を保存(保存後の ?saved=1 リダイレクトで from が落ちても戻れるように)
  useEffect(() => {
    if (backHref) sessionStorage.setItem(STORE_KEY, backHref);
  }, [backHref]);

  const close = () => {
    setShown(false);
    const target = backHref ?? sessionStorage.getItem(STORE_KEY) ?? "/app/projects";
    setTimeout(() => {
      router.push(target);
      // ルーターキャッシュに残ったインターセプトルートの状態をリセットする。
      // これが無いと、同じ案件をもう一度クリックしてもパネルが開かない。
      router.refresh();
    }, 180);
  };

  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // マウント時のみ。別の行を開いても（oppId 変化）ペインは開いたまま更新される。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // 外枠はクリックを透過（左の画面を操作できる）。パネルのみ pointer-events を有効化。
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className={`pointer-events-auto absolute right-0 top-0 h-full w-full lg:w-2/3 xl:w-[64%] max-w-[1500px] bg-mist-soft shadow-2xl ring-1 ring-black/10 flex flex-col transition-transform duration-200 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="false"
        aria-label="原価管理 案件詳細"
      >
        {/* ヘッダー（固定） */}
        <div className="flex items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-2.5 md:px-6">
          <span className="text-sm font-semibold text-ink/70">
            原価管理 案件詳細
            <span className="ml-2 text-[11px] font-normal text-ink/35">左のカレンダー/一覧から次の案件をクリックできます</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/app/projects/${oppId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-ink/60 hover:bg-black/[0.03]"
            >
              <Maximize2 size={13} /> 全画面
            </Link>
            <button
              type="button"
              onClick={close}
              aria-label="閉じる"
              className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs text-ink/60 hover:bg-black/[0.03]"
            >
              <X size={14} /> 閉じる
            </button>
          </div>
        </div>
        {/* 本文（スクロール） */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </div>
    </div>
  );
}
