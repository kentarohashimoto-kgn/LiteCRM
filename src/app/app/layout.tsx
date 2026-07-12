import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireCtx } from "@/lib/session";
import { FeedbackOverlay } from "@/components/ui/feedback-overlay";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  return (
    <div className="flex min-h-screen bg-mist-soft">
      <Sidebar role={ctx.role} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <main className="flex-1 p-6 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
      {/* 全画面共通: 更新中オーバーレイ＋完了/失敗アニメーション(useSearchParams利用のためSuspense) */}
      <Suspense fallback={null}>
        <FeedbackOverlay />
      </Suspense>
    </div>
  );
}
