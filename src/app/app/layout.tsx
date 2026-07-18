import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { requireCtx } from "@/lib/session";
import { FeedbackOverlay } from "@/components/ui/feedback-overlay";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  return (
    <div className="flex min-h-screen bg-mist-soft">
      <Sidebar role={ctx.role} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        {/* モバイルはボトムナビの高さ分だけ下余白を確保 */}
        <main className="flex-1 w-full min-w-0 p-4 pb-24 md:p-6">{children}</main>
      </div>
      {/* モバイルモード: ボトムタブ＋ドロワーメニュー(md未満のみ表示) */}
      <MobileNav role={ctx.role} />
      {/* 全画面共通: 更新中オーバーレイ＋完了/失敗アニメーション(useSearchParams利用のためSuspense) */}
      <Suspense fallback={null}>
        <FeedbackOverlay />
      </Suspense>
    </div>
  );
}
