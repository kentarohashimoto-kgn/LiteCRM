"use client";

import { useState } from "react";
import { CustomerPicker } from "./customer-picker";

/**
 * 案件登録フォームの「顧客＋案件名」セクション。
 * 顧客(既存/リード/新規)を選ぶと、未入力の案件名に会社名を自動補完する(編集可)。
 */
export function OppCustomerSection({ defaultName = "" }: { defaultName?: string }) {
  const [name, setName] = useState(defaultName);
  const [touched, setTouched] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <label className="label">顧客 *</label>
        <CustomerPicker
          onCompanyResolved={(company) => {
            // 案件名が未入力(未編集)なら会社名を補完
            if (!touched && !name.trim() && company.trim()) setName(company.trim());
          }}
        />
      </div>
      <div>
        <label className="label">案件名 *</label>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => { setName(e.target.value); setTouched(true); }}
          className="input"
          placeholder="例：株式会社○○ / 生成AI企業研修（顧客を選ぶと自動で入ります）"
        />
      </div>
    </div>
  );
}
