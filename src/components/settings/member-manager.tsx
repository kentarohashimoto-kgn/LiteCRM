"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMemberAction, setMemberEmailAction, setMemberPasswordAction, deleteMemberAction } from "@/server/actions/masters";
import { cn } from "@/lib/utils";

interface Member { userId: string; name: string; email: string; role: string; memo: string | null; }
interface Role { key: string; label: string; }

export function MemberManager({ members, roles, currentUserId }: { members: Member[]; roles: Role[]; currentUserId: string }) {
  return (
    <div className="divide-y divide-black/[0.05]">
      {members.map((m) => <MemberRow key={m.userId} m={m} roles={roles} isSelf={m.userId === currentUserId} />)}
    </div>
  );
}

function MemberRow({ m, roles, isSelf }: { m: Member; roles: Role[]; isSelf: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(m.name);
  const [role, setRole] = useState(m.role);
  const [memo, setMemo] = useState(m.memo ?? "");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(m.email);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(p: Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true); setMsg(null);
    const r = await p;
    setBusy(false);
    setMsg(r.ok ? okMsg : (r.error ?? "失敗しました"));
    if (r.ok) router.refresh();
  }

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[140px] flex-1">
          <label className="block text-[10px] text-ink/45 mb-0.5">氏名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input py-1 text-sm" />
        </div>
        <div>
          <label className="block text-[10px] text-ink/45 mb-0.5">ロール</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm outline-none focus:border-teal-primary">
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="block text-[10px] text-ink/45 mb-0.5">メモ</label>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="担当領域・備考" className="input py-1 text-sm" />
        </div>
        <button type="button" disabled={busy} onClick={() => run(updateMemberAction({ userId: m.userId, name, role, memo: memo || null }), "保存しました")} className="btn-accent text-xs py-1">保存</button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-ink/50 hover:text-ink px-2 py-1">{open ? "閉じる" : "認証・削除"}</button>
      </div>
      <div className="text-[11px] text-ink/40 mt-1">{m.email}</div>

      {open && (
        <div className="mt-2 rounded-lg border border-black/[0.06] bg-mist-soft/30 p-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[10px] text-ink/45 mb-0.5">メールアドレス変更</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="input py-1 text-sm" />
            </div>
            <button type="button" disabled={busy} onClick={() => run(setMemberEmailAction({ userId: m.userId, email }), "メールを変更しました")} className="btn-ghost text-xs py-1">変更</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[10px] text-ink/45 mb-0.5">パスワード再設定(8文字以上)</label>
              <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="新しいパスワード" className="input py-1 text-sm" />
            </div>
            <button type="button" disabled={busy || pw.length < 8} onClick={() => run(setMemberPasswordAction({ userId: m.userId, password: pw }).then((r) => { if (r.ok) setPw(""); return r; }), "パスワードを再設定しました")} className="btn-ghost text-xs py-1">再設定</button>
          </div>
          {!isSelf && (
            <button type="button" disabled={busy} onClick={() => { if (confirm(`${m.name} を削除します。よろしいですか？`)) run(deleteMemberAction({ userId: m.userId }), "削除しました"); }} className="text-xs text-rose-500 hover:underline">このメンバーを削除</button>
          )}
        </div>
      )}
      {msg && <div className={cn("text-[11px] mt-1", msg.includes("しました") ? "text-teal-deep" : "text-rose-500")}>{msg}</div>}
    </div>
  );
}
