"use client";

import { useState } from "react";

const fmt = (digits: string) => (digits ? Number(digits).toLocaleString("ja-JP") : "");
const toDigits = (v: number | string | null | undefined) => (v == null || v === "" ? "" : String(v).replace(/[^\d]/g, ""));

/**
 * 金額入力(カンマ区切り表示)。入力中も 25,000,000 のように3桁ごとに整形し、
 * フォームには数字のみ(hidden)を送る。サーバー側のパース変更は不要。
 * 途中編集でもカーソル位置を維持する。
 * value + onValueChange を渡すと制御モード(親stateに生数字を通知)になる。
 */
export function MoneyInput({
  name,
  defaultValue,
  value,
  onValueChange,
  className = "input text-right",
  placeholder = "0",
  required,
  disabled,
  form,
}: {
  name: string;
  defaultValue?: number | string | null;
  value?: number | string | null; // 制御モード: 生数字(または数値)
  onValueChange?: (raw: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  form?: string;
}) {
  const isControlled = value !== undefined;
  const [inner, setInner] = useState(fmt(toDigits(defaultValue)));
  const display = isControlled ? fmt(toDigits(value)) : inner;
  const raw = display.replace(/[^\d]/g, "");

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const caret = el.selectionStart ?? el.value.length;
    // カーソルより左にある数字の個数を覚え、整形後も同じ数字の後ろへ戻す
    const digitsBefore = el.value.slice(0, caret).replace(/[^\d]/g, "").length;
    const d = el.value.replace(/[^\d]/g, "");
    const next = fmt(d);
    if (isControlled) onValueChange?.(d);
    else setInner(next);
    requestAnimationFrame(() => {
      let pos = 0, seen = 0;
      while (pos < next.length && seen < digitsBefore) {
        if (/\d/.test(next[pos])) seen++;
        pos++;
      }
      try { el.setSelectionRange(pos, pos); } catch { /* detach時は無視 */ }
    });
  };

  return (
    <>
      <input type="hidden" name={name} value={raw} form={form} />
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        placeholder={placeholder}
        className={className}
        required={required}
        disabled={disabled}
        form={form}
        onChange={onChange}
      />
    </>
  );
}
