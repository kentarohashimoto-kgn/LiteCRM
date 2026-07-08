"use client";

import { useState } from "react";
import { CustomerPicker } from "./customer-picker";
import { SourceSelect, type SourceDetailOption } from "./source-select";

interface Option { id: string; name: string; }

/**
 * 案件登録フォームの「顧客＋案件名＋流入経路」セクション。
 * - 顧客(既存/リード/新規)を選ぶと未入力の案件名に会社名を自動補完
 * - リードから選ぶと、そのリードの流入経路・詳細(展示会名等)を流入経路欄へ自動反映
 */
export function OppCustomerSection({
  sources,
  details,
  defaultName = "",
}: {
  sources: Option[];
  details: SourceDetailOption[];
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [touched, setTouched] = useState(false);
  // リード選択で流入経路欄を再初期化するためのソース状態(keyで再マウント)
  const [src, setSrc] = useState<{ sourceId: string; detail: string }>({ sourceId: "", detail: "" });

  return (
    <div className="space-y-3">
      <div>
        <label className="label">顧客 *</label>
        <CustomerPicker
          onCompanyResolved={(company) => {
            if (!touched && !name.trim() && company.trim()) setName(company.trim());
          }}
          onSourceResolved={(sourceId, detail) => {
            setSrc({ sourceId: sourceId ?? "", detail: detail ?? "" });
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
      <div>
        <label className="label">流入経路（リードから選ぶと自動で入ります）</label>
        <SourceSelect
          key={`${src.sourceId}|${src.detail}`}
          sources={sources}
          details={details}
          defaultSourceId={src.sourceId}
          defaultDetail={src.detail}
        />
      </div>
    </div>
  );
}
