"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, TriangleAlert, Users, TrendingUp, X } from "lucide-react";
import { saveDeliveryForecastAction, deleteDeliveryForecastAction } from "@/server/actions/forecasts";
import type { ForecastData, ForecastRow } from "@/lib/data/forecasts";

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const yenShort = (n: number): string => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};
const ymLabel = (m: string) => Number(m.split("-")[1]) + "月";

function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a, guard = 0;
  while (guard++ < 30) { out.push(cur); if (cur === b) break; cur = addMonths(cur, 1); }
  return out;
}

const KIND = { continuation: { label: "継続", cls: "bg-violet-50 text-violet-700" }, new: { label: "新規", cls: "bg-sky-50 text-sky-700" } } as const;
const STAFF = {
  ready: { label: "手当済", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  shortage: { label: "要手配", cls: "bg-rose-50 text-rose-600", dot: "bg-rose-500" },
  unknown: { label: "未定", cls: "bg-mist-soft text-ink/50", dot: "bg-ink/25" },
} as const;
const probCls = (p: number) => (p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-rose-400");

/** デリバリー見込み(継続/延長・新規受注見込み)と人員手配の可視化パネル。 */
export function ForecastPanel({ data }: { data: ForecastData }) {
  const { rows, nowMonth, alerts } = data;
  const [edit, setEdit] = useState<ForecastRow | "new" | null>(null);

  // 表示する月ウィンドウ: 今月〜+11 を基本に、見込みの期間も含める(最大24ヶ月)
  const win = useMemo(() => {
    const set = new Set<string>([nowMonth, addMonths(nowMonth, 11)]);
    for (const f of rows) { if (f.startMonth) set.add(f.startMonth); if (f.endMonth) set.add(f.endMonth); }
    const sorted = [...set].sort();
    let start = sorted[0], end = sorted[sorted.length - 1];
    // 上限24ヶ月に丸める
    if (monthsBetween(start, end).length > 24) end = addMonths(start, 23);
    return monthsBetween(start, end);
  }, [rows, nowMonth]);

  // 表示ウィンドウの月次デマンド(加重見込み・必要人数)
  const footer = useMemo(() => {
    const map = new Map(win.map((m) => [m, { weighted: 0, required: 0, shortage: 0 }]));
    for (const f of rows) for (const m of f.months) {
      const c = map.get(m); if (!c) continue;
      c.weighted += (f.monthlyAmount * f.probability) / 100;
      c.required += f.requiredHeadcount;
      if (f.staffingStatus === "shortage") c.shortage += f.requiredHeadcount;
    }
    return map;
  }, [rows, win]);

  const COL = 62, NAME = 240;

  return (
    <div className="space-y-4">
      {/* アラート */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-black/[0.06] bg-white p-3">
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><TrendingUp size={13} /> 今後6ヶ月の受注見込み(確度加重)</div>
          <div className="stat-value mt-1 text-teal-deep">{yen(alerts.next6Weighted)}</div>
          <div className="text-[11px] text-ink/40">素の見込み {yen(alerts.next6Raw)}</div>
        </div>
        <div className={`rounded-xl border p-3 ${alerts.shortageHeadcountNext3 > 0 ? "border-rose-200 bg-rose-50/50" : "border-black/[0.06] bg-white"}`}>
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><Users size={13} /> 今後3ヶ月で要手配の人員</div>
          <div className={`stat-value mt-1 ${alerts.shortageHeadcountNext3 > 0 ? "text-rose-600" : "text-ink/80"}`}>{alerts.shortageHeadcountNext3}<span className="stat-unit">名</span></div>
          <div className="text-[11px] text-ink/40">要手配なら採用/契約を今すぐ</div>
        </div>
        <div className={`rounded-xl border p-3 ${alerts.actionItems.length > 0 ? "border-amber-200 bg-amber-50/50" : "border-black/[0.06] bg-white"}`}>
          <div className="flex items-center gap-1.5 text-xs text-ink/45"><TriangleAlert size={13} /> 要アクション(期限接近/開始間近)</div>
          <div className={`stat-value mt-1 ${alerts.actionItems.length > 0 ? "text-amber-700" : "text-ink/80"}`}>{alerts.actionItems.length}<span className="stat-unit">件</span></div>
          <div className="text-[11px] text-ink/40">手配未完で調整期限が近い見込み</div>
        </div>
      </div>

      {alerts.actionItems.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-amber-700">🚨 早めの調整が必要な見込み</div>
          {alerts.actionItems.slice(0, 8).map((f) => (
            <button key={f.id} type="button" onClick={() => setEdit(f)} className="flex w-full items-center gap-2 text-left text-xs rounded-lg px-2 py-1 hover:bg-white/70">
              <span className={`pill ${KIND[f.kind].cls} text-[10px] font-bold`}>{KIND[f.kind].label}</span>
              <span className="font-medium text-ink/80">{f.title}</span>
              <span className="text-ink/45">開始 {f.startMonth ? ymFull(f.startMonth) : "—"}</span>
              {f.arrangeDeadline && <span className="text-rose-600">調整期限 {f.arrangeDeadline}</span>}
              <span className="text-ink/55">必要 {f.requiredHeadcount || 0}名</span>
              <span className={`pill ${STAFF[f.staffingStatus].cls} text-[10px]`}>{STAFF[f.staffingStatus].label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink/45">確定/完了とは別枠の「見込み」です。バー＝見込み期間（色＝確度）、下段＝月別の受注見込み(加重)と必要人員。</p>
        <button type="button" onClick={() => setEdit("new")} className="inline-flex items-center gap-1 rounded-lg bg-teal-primary px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep">
          <Plus size={14} /> 見込みを追加
        </button>
      </div>

      {/* タイムライン + 月次デマンド */}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-ink/45">見込みがまだありません。「見込みを追加」から継続・延長や新規受注の見込みを登録してください。</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
          <div style={{ minWidth: NAME + win.length * COL }}>
            {/* ヘッダ月 */}
            <div className="flex sticky top-0 z-10 bg-mist-soft/60 text-xs text-ink/50 border-b border-black/[0.06]">
              <div className="shrink-0 px-3 py-2 font-medium" style={{ width: NAME }}>見込み案件</div>
              {win.map((m) => (
                <div key={m} className={`shrink-0 text-center py-2 border-l ${m === nowMonth ? "bg-teal-light/60 text-teal-deep font-bold" : "border-black/[0.04]"}`} style={{ width: COL }}>
                  <div className="leading-tight">{ymLabel(m)}</div>
                  <div className="text-[10px] text-ink/35">{m.endsWith("-01") || m === win[0] ? m.split("-")[0] : ""}</div>
                </div>
              ))}
            </div>
            {/* 見込み行 */}
            <div className="divide-y divide-black/[0.04]">
              {rows.map((f) => (
                <div key={f.id} className="flex row-hover items-stretch">
                  <div className="shrink-0 px-3 py-2" style={{ width: NAME }}>
                    <div className="flex items-center gap-1.5">
                      <span className={`pill ${KIND[f.kind].cls} text-[10px] font-bold`}>{KIND[f.kind].label}</span>
                      <span className="font-medium text-ink/90 text-sm truncate">{f.title}</span>
                    </div>
                    <div className="text-[11px] text-ink/50 mt-0.5">
                      {f.amountBasis === "monthly" ? `月額 ${yen(f.monthlyAmount)}` : `総額 ${yen(f.totalAmount)}`}・確度 {f.probability}%・必要 {f.requiredHeadcount || 0}名
                      <span className={`ml-1 inline-flex items-center gap-1`}><span className={`inline-block w-1.5 h-1.5 rounded-full ${STAFF[f.staffingStatus].dot}`} />{STAFF[f.staffingStatus].label}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {f.arrangeDeadline && <span className="text-[10px] text-rose-600">調整期限 {f.arrangeDeadline}</span>}
                      <button type="button" onClick={() => setEdit(f)} className="text-[10px] text-ink/40 hover:text-teal-deep inline-flex items-center gap-0.5"><Pencil size={10} />編集</button>
                    </div>
                  </div>
                  {win.map((m) => {
                    const inSpan = f.startMonth && f.endMonth ? m >= f.startMonth && m <= f.endMonth : m === f.startMonth;
                    const isStart = m === f.startMonth, isEnd = m === f.endMonth;
                    return (
                      <div key={m} className={`shrink-0 relative border-l ${m === nowMonth ? "bg-teal-light/25" : "border-black/[0.03]"}`} style={{ width: COL }}>
                        {inSpan && (
                          <div
                            className={`absolute inset-y-2 flex items-center justify-center text-[10px] font-semibold text-white ${probCls(f.probability)} ${f.staffingStatus === "shortage" ? "ring-2 ring-rose-300" : ""}`}
                            style={{ left: isStart ? 5 : 0, right: isEnd ? 5 : 0, borderTopLeftRadius: isStart ? 6 : 0, borderBottomLeftRadius: isStart ? 6 : 0, borderTopRightRadius: isEnd ? 6 : 0, borderBottomRightRadius: isEnd ? 6 : 0 }}
                            title={`${f.title} ${m}: 月額${yen(f.monthlyAmount)} / 確度${f.probability}%`}
                          >
                            {yenShort(f.monthlyAmount)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* フッタ: 月次デマンド */}
            <div className="border-t-2 border-black/10 bg-mist-soft/20 text-[11px]">
              <div className="flex">
                <div className="shrink-0 px-3 py-1.5 font-medium text-ink/60" style={{ width: NAME }}>受注見込み(加重)</div>
                {win.map((m) => { const c = footer.get(m)!; return <div key={m} className={`shrink-0 text-center py-1.5 border-l border-black/[0.03] ${m === nowMonth ? "bg-teal-light/30" : ""} text-teal-deep font-semibold`} style={{ width: COL }}>{c.weighted ? yenShort(c.weighted) : ""}</div>; })}
              </div>
              <div className="flex border-t border-black/[0.05]">
                <div className="shrink-0 px-3 py-1.5 font-medium text-ink/60" style={{ width: NAME }}>必要人員（うち要手配）</div>
                {win.map((m) => { const c = footer.get(m)!; return (
                  <div key={m} className={`shrink-0 text-center py-1.5 border-l border-black/[0.03] ${m === nowMonth ? "bg-teal-light/30" : ""}`} style={{ width: COL }}>
                    {c.required ? <span className="text-ink/70 font-semibold">{c.required}{c.shortage > 0 && <span className="text-rose-600">({c.shortage})</span>}</span> : ""}
                  </div>
                ); })}
              </div>
            </div>
          </div>
        </div>
      )}

      {edit !== null && <ForecastForm forecast={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ymFull(m: string) { const [y, mo] = m.split("-"); return `${y}/${Number(mo)}`; }

/** 見込みの登録/編集フォーム(モーダル)。サーバーアクションを直接呼び、完了で閉じる。 */
function ForecastForm({ forecast, onClose }: { forecast: ForecastRow | null; onClose: () => void }) {
  const [pending, start] = useTransition();
  const f = forecast;
  const monthInput = (m: string | null) => (m ? m : "");

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => { await saveDeliveryForecastAction(fd); onClose(); });
  };
  const remove = () => {
    if (!f) return;
    const fd = new FormData(); fd.set("id", f.id);
    start(async () => { await deleteDeliveryForecastAction(fd); onClose(); });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-ink/90">{f ? "見込みを編集" : "見込みを追加"}</h3>
          <button type="button" onClick={onClose} className="text-ink/40 hover:text-ink/70"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          {f && <input type="hidden" name="id" value={f.id} />}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">区分</span>
              <select name="kind" defaultValue={f?.kind ?? "continuation"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="continuation">継続 / 延長</option>
                <option value="new">新規見込み</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">受注確度（%）</span>
              <input name="probability" type="number" min={0} max={100} defaultValue={f?.probability ?? 50} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-ink/50">タイトル（例: 日本トムソン(継続)）</span>
            <input name="title" required defaultValue={f?.title ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">開始月</span>
              <input name="start_month" type="month" defaultValue={monthInput(f?.startMonth ?? null)} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">終了月</span>
              <input name="end_month" type="month" defaultValue={monthInput(f?.endMonth ?? null)} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">金額（円）</span>
              <input name="amount" type="number" min={0} step={10000} defaultValue={f?.amount ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">金額の単位</span>
              <select name="amount_basis" defaultValue={f?.amountBasis ?? "monthly"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="monthly">月額</option>
                <option value="total">総額</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-ink/50">必要人数（同時稼働）</span>
              <input name="required_headcount" type="number" min={0} step={0.5} defaultValue={f?.requiredHeadcount ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-xs text-ink/50">人員手配</span>
              <select name="staffing_status" defaultValue={f?.staffingStatus ?? "unknown"} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5">
                <option value="unknown">未定</option>
                <option value="shortage">要手配</option>
                <option value="ready">手当済</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-ink/50">契約/採用の調整期限</span>
            <input name="arrange_deadline" type="date" defaultValue={f?.arrangeDeadline ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-ink/50">メモ</span>
            <textarea name="notes" rows={2} defaultValue={f?.notes ?? ""} className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5" />
          </label>
          <div className="flex items-center justify-between pt-1">
            {f ? (
              <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700"><Trash2 size={13} /> 削除</button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-ghost text-xs">キャンセル</button>
              <button type="submit" disabled={pending} className="rounded-lg bg-teal-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-deep disabled:opacity-50">{pending ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
