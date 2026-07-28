"use client";

import { useState } from "react";
import { MessageSquare, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { sendTestChatDmAction, type ChatDmTestResult } from "@/server/actions/chat-test";

/** Google Chat DM のテスト送信ボタン(通知トラブルシュート)。 */
export function ChatDmTest() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ChatDmTestResult | null>(null);

  const run = async () => {
    setBusy(true);
    try { setRes(await sendTestChatDmAction()); } finally { setBusy(false); }
  };

  const Step = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-teal-deep" : "text-rose-600"}`}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink/55">
        ホットリード通知(Google Chat DM)が届かない時の切り分けに使います。自分宛にテストDMを送り、どの段階で止まっているかを表示します。
      </p>
      <button onClick={run} disabled={busy} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Chat DM テスト送信
      </button>
      {res && (
        <div className="rounded-xl border border-black/10 p-3 text-sm space-y-1.5">
          <div className="flex flex-wrap gap-3">
            <Step ok={res.configured} label="サーバー設定" />
            <Step ok={res.hasIdentity} label="Chat連携登録" />
            <Step ok={res.hasChatUserId} label="ユーザー紐付け" />
            <Step ok={res.hasDmSpace || res.sent > 0} label="DMスペース" />
            <Step ok={res.sent > 0} label="送信" />
          </div>
          <p className={`flex items-start gap-1.5 text-xs ${res.ok ? "text-teal-deep" : "text-rose-600"}`}>
            {res.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
            {res.hint}
          </p>
        </div>
      )}
    </div>
  );
}
