"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, X, Lock, Loader2 } from "lucide-react";
import { addProjectMemberAction, removeProjectMemberAction } from "@/server/actions/tasks";
import { cn, initials } from "@/lib/utils";

interface U {
  id: string;
  name: string;
  avatarColor?: string;
}

/**
 * プロジェクトの参照権限（メンバー割当）。割当・解除は管理者(owner/admin)のみ。
 * メンバー未割当のプロジェクトは「割当メンバー＋管理者」のみ参照可能。
 */
export function ProjectMembers({
  projectId,
  members,
  allUsers,
  isAdmin,
}: {
  projectId: string;
  members: U[];
  allUsers: U[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");
  const candidates = allUsers.filter((u) => !members.some((m) => m.id === u.id));

  const add = () => {
    if (!pick) return;
    start(async () => {
      await addProjectMemberAction(projectId, pick);
      setPick("");
      router.refresh();
    });
  };
  const remove = (userId: string) => {
    start(async () => {
      await removeProjectMemberAction(projectId, userId);
      router.refresh();
    });
  };

  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2 mb-2.5">
        <Users size={15} className="text-teal-deep" />
        <span className="text-sm font-bold text-ink">参照メンバー</span>
        {pending && <Loader2 size={13} className="animate-spin text-ink/30" />}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink/40">
          <Lock size={11} /> 管理者のみ割当
        </span>
      </div>

      {members.length === 0 ? (
        <p className="text-xs text-ink/45 mb-2">
          メンバー未割当。現在は<b>管理者と作成者のみ</b>が閲覧できます。メンバーを割り当てると、その人も閲覧できるようになります。
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {members.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-mist-soft pl-1 pr-2 py-0.5 text-xs text-ink/70">
              <span className="inline-flex items-center justify-center rounded-full text-white text-[9px] font-bold" style={{ width: 18, height: 18, backgroundColor: m.avatarColor ?? "#008C8C" }}>
                {initials(m.name)}
              </span>
              {m.name}
              {isAdmin && (
                <button type="button" onClick={() => remove(m.id)} className="text-ink/30 hover:text-rose-500" title="解除">
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {isAdmin ? (
        candidates.length > 0 ? (
          <div className="flex items-center gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="input py-1.5 text-sm w-56">
              <option value="">メンバーを追加…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button type="button" onClick={add} disabled={!pick || pending} className={cn("btn-ghost text-sm py-1.5", (!pick || pending) && "opacity-40")}>
              <Plus size={15} /> 追加
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-ink/40">全メンバーが割当済みです。</p>
        )
      ) : (
        <p className="text-[11px] text-ink/40">権限の割当は管理者のみ可能です。</p>
      )}
    </div>
  );
}
