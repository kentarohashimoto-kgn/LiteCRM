"use client";

import { useState } from "react";

const yen = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");

/** 売上逆算: 目標売上から必要アポ数・受注数を試算(File1 月次目標 売上逆算機能)。 */
export function SalesReverseCalc() {
  const [annual, setAnnual] = useState(500000000); // 年間目標(5億)
  const [unit, setUnit] = useState(2000000);       // 平均受注単価
  const [closeRate, setCloseRate] = useState(10);  // 成約率(アポ→受注)%
  const [apptToDeal, setApptToDeal] = useState(true);
  const [existingAdd, setExistingAdd] = useState(100000000);   // 既存からの追加受注見込み(年)
  const [bigDev, setBigDev] = useState(50000000);              // 開発大型受注見込み(年)

  const newSalesNeeded = Math.max(0, annual - existingAdd - bigDev); // 新規で作るべき売上
  const dealsNeeded = unit > 0 ? newSalesNeeded / unit : 0;          // 必要受注数(年)
  const rate = closeRate / 100;
  const apptsNeeded = rate > 0 ? dealsNeeded / rate : 0;            // 必要アポ数(年)
  const monthlyAppts = apptsNeeded / 12;
  const monthlyDeals = dealsNeeded / 12;
  const monthlySales = newSalesNeeded / 12;

  return (
    <div className="space-y-4">
      <div className="card card-pad grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="年間目標売上(円)"><input type="number" value={annual} onChange={(e) => setAnnual(+e.target.value || 0)} className="input" /></Field>
        <Field label="平均受注単価(円)"><input type="number" value={unit} onChange={(e) => setUnit(+e.target.value || 0)} className="input" /></Field>
        <Field label={`成約率(${apptToDeal ? "アポ→受注" : "商談→受注"})%`}><input type="number" value={closeRate} onChange={(e) => setCloseRate(+e.target.value || 0)} className="input" /></Field>
        <Field label="既存顧客からの追加受注見込み(年)"><input type="number" value={existingAdd} onChange={(e) => setExistingAdd(+e.target.value || 0)} className="input" /></Field>
        <Field label="開発・大型案件の受注見込み(年)"><input type="number" value={bigDev} onChange={(e) => setBigDev(+e.target.value || 0)} className="input" /></Field>
        <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={apptToDeal} onChange={(e) => setApptToDeal(e.target.checked)} className="accent-teal-primary" /> 成約率はアポ基準</label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="新規で作る売上(年)" v={yen(newSalesNeeded)} accent />
        <Stat label="必要受注数(年)" v={`${Math.ceil(dealsNeeded)}件`} />
        <Stat label="必要アポ数(年)" v={`${Math.ceil(apptsNeeded)}件`} />
        <Stat label="必要アポ数(月)" v={`${Math.ceil(monthlyAppts)}件`} accent />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="月間 受注数" v={`${Math.ceil(monthlyDeals)}件`} />
        <Stat label="月間 売上(新規)" v={yen(monthlySales)} />
        <Stat label="既存+開発(年)" v={yen(existingAdd + bigDev)} />
        <Stat label="合計目標(年)" v={yen(annual)} />
      </div>
      <p className="text-xs text-ink/40">
        ※ 「新規で作る売上 = 年間目標 − 既存追加 − 開発大型」。必要アポ数 = 必要受注数 ÷ 成約率。
        単純なアポ増だけでなく、<b>成約率改善・単価向上・既存追加・高単価案件化</b>の組み合わせで目標を狙えます（数値を動かして感度を確認）。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return <div className="card card-pad"><div className="text-xs text-ink/50">{label}</div><div className={`text-xl font-bold mt-1 tabular-nums ${accent ? "stat-accent" : ""}`}>{v}</div></div>;
}
