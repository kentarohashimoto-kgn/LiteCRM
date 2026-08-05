"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Maximize2 } from "lucide-react";

const LIST_PATH = "/app/opportunities";

/**
 * 案件一覧・カレンダーの上に重ねるスライドオーバー。右側に画面幅の約2/3で開き、
 * 背後の画面に留まったまま案件詳細・商談メモを確認・更新できる。
 *  - バックドロップは張らない → 左に残る一覧やカレンダーをそのままクリックして
 *    次の案件・次の商談へ次々切り替えられる。表示週・絞り込み・スクロールも保持される。
 *  - ✕ / ESC で閉じる（背後の画面へ戻る）。「全画面」で従来のフルページを別タブで開ける。
 */
export function DetailPane({
  oppId,
  title = "案件詳細",
  fullHref,
  children,
}: {
  oppId: string;
  title?: string;
  fullHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(false);

  const close = () => {
    setShown(false);
    // アニメーション後に一覧へ戻す（一覧はマウントされたままなので状態は保持される）
    setTimeout(() => router.push(LIST_PATH), 180);
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
    // 外枠はクリックを透過（左の一覧を操作できる）。パネルのみ pointer-events を有効化。
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        className={`pointer-events-auto absolute right-0 top-0 h-full w-full lg:w-2/3 xl:w-[64%] max-w-[1500px] bg-mist-soft shadow-2xl ring-1 ring-black/10 flex flex-col transition-transform duration-200 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="false"
        aria-label={title}
      >
        {/* ヘッダー（固定） */}
        <div className="flex items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-2.5 md:px-6">
          <span className="text-sm font-semibold text-ink/70">{title}<span className="ml-2 text-[11px] font-normal text-ink/35">左の一覧・カレンダーから次の商談をクリックできます</span></span>
          <div className="flex items-center gap-1.5">
            <Link
              href={fullHref ?? `${LIST_PATH}/${oppId}`}
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
