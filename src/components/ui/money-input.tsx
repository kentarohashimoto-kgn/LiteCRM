"use client";

import { useState } from "react";

/**
 * 金額入力(カンマ区切り表示)。表示は 25,000,000 のように整形し、フォームには数字のみ(hidden)を送る。
 * サーバー側のパース変更は不要(rawの数字だけが name で送信される)。
 */
export function MoneyInput({
  name,
  defaultValue,
  className = "input text-right",
  placeholder = "0",
}: {
  name: string;
  defaultValue?: number | string | null;
  className?: string;
  placeholder?: string;
}) {
  const initRaw = defaultValue != null && defaultValue !== "" ? String(defaultValue).replace(/[^\d]/g, "") : "";
  const [display, setDisplay] = useState(initRaw ? Number(initRaw).toLocaleString("ja-JP") : "");
  const raw = display.replace(/[^\d]/g, "");

  return (
    <>
      <input type="hidden" name={name} value={raw} />
      <input
        type="text"
        inputMode="numeric"
        value={display}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, "");
          setDisplay(d ? Number(d).toLocaleString("ja-JP") : "");
        }}
      />
    </>
  );
}
