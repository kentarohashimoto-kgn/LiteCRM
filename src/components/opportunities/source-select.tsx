"use client";

import { useState } from "react";

export interface SourceOption { id: string; name: string; }
export interface SourceDetailOption { id: string; lead_source_id: string; name: string; }

const FREE = "__free__";

/**
 * 流入経路 → 流入詳細 の連動セレクト。
 * 経路(展示会/パートナー等)を選ぶと、その経路に属する詳細(各展示会・各パートナー)だけが
 * 詳細セレクトに出る。マスタにない値は「その他(直接入力)」で自由入力できる。
 * 送信は lead_source_id と source_detail(テキスト)の2フィールド。
 */
export function SourceSelect({
  sources,
  details,
  defaultSourceId = "",
  defaultDetail = "",
}: {
  sources: SourceOption[];
  details: SourceDetailOption[];
  defaultSourceId?: string;
  defaultDetail?: string;
}) {
  const [sourceId, setSourceId] = useState(defaultSourceId);
  const initialInMaster = !!defaultDetail && details.some((d) => d.lead_source_id === defaultSourceId && d.name === defaultDetail);
  const [detailSel, setDetailSel] = useState(defaultDetail ? (initialInMaster ? defaultDetail : FREE) : "");
  const [freeText, setFreeText] = useState(initialInMaster ? "" : defaultDetail);

  const options = details.filter((d) => d.lead_source_id === sourceId);
  const useFree = detailSel === FREE;

  return (
    <>
      <div>
        <label className="label">流入経路</label>
        <select
          name="lead_source_id"
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setDetailSel(""); // 経路を変えたら詳細をリセット
            setFreeText("");
          }}
          className="input"
        >
          <option value="">選択してください</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">流入詳細（どの展示会・どのパートナー等）</label>
        <select
          name={useFree ? undefined : "source_detail"}
          value={detailSel}
          onChange={(e) => setDetailSel(e.target.value)}
          className="input"
          disabled={!sourceId}
        >
          <option value="">{sourceId ? (options.length ? "選択してください" : "登録された詳細がありません") : "先に流入経路を選択"}</option>
          {options.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          {sourceId && <option value={FREE}>その他（直接入力）</option>}
        </select>
        {useFree && (
          <input
            name="source_detail"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            className="input mt-1.5"
            placeholder="詳細を入力（保存時にマスタへ自動追加されます）"
            autoFocus
          />
        )}
      </div>
    </>
  );
}
