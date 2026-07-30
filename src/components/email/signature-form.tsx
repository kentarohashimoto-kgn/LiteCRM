"use client";

import { useState } from "react";
import { PenSquare } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveMailSignatureAction } from "@/server/actions/mail-signature";

/**
 * 送信者ごとの署名(0181)の編集。テンプレ本文の {signature} に差し込まれる。
 * 同じテンプレを複数人で使い回しても、末尾の氏名・役職・連絡先は送信者のものになる。
 */
export function SignatureForm({ signature, disabled }: { signature: string | null; disabled?: boolean }) {
  const [text, setText] = useState(signature ?? "");
  const empty = !text.trim();

  return (
    <form action={saveMailSignatureAction} className="max-w-xl space-y-2">
      <p className="text-xs text-ink/55">
        テンプレ本文に <code className="rounded bg-mist-soft px-1">{"{signature}"}</code> と書いた箇所が、ここで設定した署名に置き換わります。
        会社名・役職・氏名・連絡先・SNSなど、<b>送信者ごとに変わる末尾のブロック</b>を入れてください。
      </p>
      <textarea
        name="signature"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        rows={10}
        maxLength={2000}
        placeholder={"----------------------------------------------------------------\n株式会社カトルセ\n役職　氏名\n〒000-0000　住所\nTEL 00-0000-0000\nHP　https://example.com/\nMAIL　you@example.com\n----------------------------------------------------------------"}
        className="input font-normal leading-relaxed text-sm"
      />
      {empty && (
        <p className="text-xs text-amber-700">
          署名が未設定です。このままだとテンプレの {"{signature}"} は空欄で送信されます。
        </p>
      )}
      <div className="flex items-center gap-2">
        <SubmitButton className="btn-accent inline-flex items-center gap-1 text-sm" pendingLabel="保存中…">
          <PenSquare size={14} /> 署名を保存
        </SubmitButton>
        <span className="text-[11px] text-ink/40">{text.length} / 2000</span>
      </div>
    </form>
  );
}
