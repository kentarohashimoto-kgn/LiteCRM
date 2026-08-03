"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Menu, Plus, X } from "lucide-react";
import { labSignOut } from "@/server/actions/ai-lab-auth";
import type { LabUiConversation } from "@/lib/ai-lab/ui-types";
import { ConversationList } from "./conversation-list";

/**
 * 顧客向け体験環境の2ペインレイアウト。
 * CRM本体の Sidebar / Topbar は意図的に共有しない(受講者にCRMの情報構造を見せないため)。
 */
export function LabShell({
  slug,
  companyName,
  displayName,
  conversations,
  activeId,
  children,
}: {
  slug: string;
  companyName: string;
  displayName: string;
  conversations: LabUiConversation[];
  activeId: string | null;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col bg-teal-deep">
      <div className="px-4 pt-4 pb-3">
        <p className="truncate text-sm font-bold text-white">{companyName}</p>
        <p className="text-[11px] text-white/50">生成AI体験環境</p>
      </div>
      <div className="px-3 pb-3">
        <Link
          href={`/lab/${slug}/chat`}
          onClick={() => setDrawerOpen(false)}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/25"
        >
          <Plus size={16} />
          新しいチャット
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ConversationList
          slug={slug}
          conversations={conversations}
          activeId={activeId}
          onNavigate={() => setDrawerOpen(false)}
        />
      </nav>
      <div className="border-t border-white/10 px-3 py-3">
        <p className="truncate px-1 text-xs text-white/70">{displayName}</p>
        <form action={labSignOut} className="mt-2">
          <input type="hidden" name="slug" value={slug} />
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-xs text-white/50 transition-colors hover:text-white"
          >
            <LogOut size={13} />
            ログアウト
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-mist-soft">
      <aside className="hidden w-64 shrink-0 md:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-black/[0.06] bg-white px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="rounded-lg p-2 text-ink/70 hover:bg-mist-soft"
            aria-label="履歴を開く"
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="truncate text-sm font-semibold text-ink">{companyName}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
