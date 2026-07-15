"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import type { OppView } from "@/lib/data/select";
import { leanToOppView } from "@/lib/data/opps-page";
import {
  fetchOppsPageAction,
  listOppViewPresetsAction,
  saveOppViewPresetAction,
  deleteOppViewPresetAction,
  bulkUpdateOppsAction,
  bulkCreateTasksAction,
  type OppPageFilter,
  type OppViewPreset,
} from "@/server/actions/opportunities";
import { YOMI_OPTIONS } from "@/lib/constants";
import { YomiBadge, StageBadge } from "@/components/ui/badges";
import { Avatar } from "@/components/ui/primitives";
import { formatYen, formatDate, daysSince, cn } from "@/lib/utils";
import { InlineYomi, InlineAmount, InlineNextDate, type OnEdited } from "./opp-inline";
import { StickyGrid } from "@/components/ui/sticky-grid";
import { NextActionStatus } from "./next-action-status";
import { TaskCheckbox } from "@/components/tasks/task-checkbox";
import { toggleTaskDoneAction } from "@/server/actions/tasks";

interface Option { id: string; name: string; }
type SortKey =
  | "name"
  | "yomi"
  | "owner"
  | "product"
  | "source_detail"
  | "stage"
  | "amount"
  | "probability"
  | "expected_close_date"
  | "next_action_date"
  | "last_activity_at"
  | "meeting_count"
  | "last_meeting_date";

// 昇順が自然な列(文字列・段階・日付)。金額/確度/最終活動/商談回数/直近商談は降順から。
const ASC_FIRST: SortKey[] = ["name", "yomi", "owner", "product", "source_detail", "stage", "expected_close_date", "next_action_date"];
const PAGE = 50;

export function OppPaginatedTable({
  initialRows,
  initialTotal,
  initialSumAmount,
  initialSumWeighted,
  owners,
  products,
  sources,
  campaigns = [],
  canReassign = false,
}: {
  initialRows: OppView[];
  initialTotal: number;
  initialSumAmount: number;
  initialSumWeighted: number;
  owners: Option[];
  products: Option[];
  sources: Option[];
  campaigns?: Option[];
  canReassign?: boolean;
}) {
  const [q, setQ] = useState("");
  const [yomiSel, setYomiSel] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [onlyNoNext, setOnlyNoNext] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [sort, setSort] = useState<SortKey>("expected_close_date");
  const [asc, setAsc] = useState(true);

  // 保存ビュー(絞込プリセット)
  const [presets, setPresets] = useState<OppViewPreset[]>([]);
  useEffect(() => { listOppViewPresetsAction().then(setPresets); }, []);

  function applyPreset(p: OppViewPreset) {
    const v = p.params as Record<string, unknown>;
    setQ((v.q as string) ?? "");
    setYomiSel((v.yomi as string[]) ?? []);
    setOwner((v.owner as string) ?? "");
    setProduct((v.product as string) ?? "");
    setSource((v.source as string) ?? "");
    setCampaign((v.campaign as string) ?? "");
    setOnlyNoNext(Boolean(v.only_no_next));
    setOnlyStale(Boolean(v.only_stale));
    if (v.sort) setSort(v.sort as SortKey);
    if (typeof v.asc === "boolean") setAsc(v.asc);
  }

  async function saveCurrentAsPreset() {
    const name = window.prompt("この絞込条件の名前（例: 自分の今月クロージング）");
    if (!name) return;
    const isShared = window.confirm("チーム全員に共有しますか？（キャンセル=自分だけ）");
    const res = await saveOppViewPresetAction({
      name,
      isShared,
      params: { q, yomi: yomiSel, owner, product, source, campaign, only_no_next: onlyNoNext, only_stale: onlyStale, sort, asc },
    });
    if (res.ok && res.preset) setPresets((ps) => [...ps, res.preset!]);
    else alert(res.error ?? "保存に失敗しました");
  }

  async function removePreset(id: string) {
    if (!window.confirm("この保存ビューを削除しますか？")) return;
    const res = await deleteOppViewPresetAction({ id });
    if (res.ok) setPresets((ps) => ps.filter((p) => p.id !== id));
  }

  // CSVエクスポート(現在の絞込条件で全件)
  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    const res = await fetchOppsPageAction({ filter, sort, asc, offset: 0, limit: 5000 });
    const header = ["顧客", "案件名", "ヨミ", "担当", "商材", "展示会/施策", "流入経路", "金額", "確度", "商談回数", "直近商談日", "受注予定", "見込月", "次回AC日", "次回AC内容", "ステータス", "メモ"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = res.rows.map((r) => [
      r.account_name, r.name, r.yomi, r.owner_name, r.product_name, r.source_detail ?? r.campaign_name, r.source_name,
      r.amount, r.probability + "%", r.meeting_count ?? 0, r.last_meeting_date ?? "", r.expected_close_date ?? "", (r.expected_revenue_month ?? "").slice(0, 7),
      r.next_action_date ?? "", r.next_action_text ?? "", r.status, r.notes ?? "",
    ].map(esc).join(","));
    const csv = "\uFEFF" + header.map(esc).join(",") + "\n" + lines.join("\n"); // BOM付きUTF-8(Excel対応)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `案件_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
  }

  const [rows, setRows] = useState<OppView[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [sumAmount, setSumAmount] = useState(initialSumAmount);
  const [sumWeighted, setSumWeighted] = useState(initialSumWeighted);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialRows.length);
  const hasMore = rows.length < total;

  // A-6 一括操作: 選択行
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleRow = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : rows.map((r) => r.id));

  async function runBulk(field: "owner_user_id" | "yomi", value: string) {
    if (!value || bulkBusy) return;
    const label = field === "owner_user_id" ? "担当" : "ヨミ";
    if (!window.confirm(`選択中の${selected.length}件の${label}を一括変更します。よろしいですか？`)) return;
    setBulkBusy(true);
    const res = await bulkUpdateOppsAction({ ids: selected, field, value });
    setBulkBusy(false);
    if (!res.ok) { alert(res.error ?? "一括変更に失敗しました"); return; }
    setSelected([]);
    offsetRef.current = 0;
    await load(0, true);
  }

  async function runBulkTask() {
    if (bulkBusy) return;
    const title = window.prompt(`選択中の${selected.length}件にタスクを作成します。タスク名を入力:`, "フォローアップ");
    if (!title) return;
    const defaultDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dueDate = window.prompt("期日(YYYY-MM-DD):", defaultDue);
    if (!dueDate) return;
    setBulkBusy(true);
    const res = await bulkCreateTasksAction({ ids: selected, title, dueDate });
    setBulkBusy(false);
    if (!res.ok) { alert(res.error ?? "タスク作成に失敗しました"); return; }
    alert(`${res.created}件のタスクを作成しました（担当=各案件の担当者）`);
    setSelected([]);
  }

  const filter: OppPageFilter = useMemo(
    () => ({
      q: q.trim() || undefined,
      yomi: yomiSel.length ? yomiSel : undefined,
      owner: owner || undefined,
      product: product || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
      only_no_next: onlyNoNext || undefined,
      only_stale: onlyStale || undefined,
    }),
    [q, yomiSel, owner, product, source, campaign, onlyNoNext, onlyStale],
  );

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      const res = await fetchOppsPageAction({ filter, sort, asc, offset, limit: PAGE });
      const views = res.rows.map(leanToOppView);
      offsetRef.current = offset + views.length;
      setRows((prev) => (replace ? views : [...prev, ...views]));
      setTotal(res.total);
      setSumAmount(res.sum_amount);
      setSumWeighted(res.sum_weighted);
      setLoading(false);
    },
    [filter, sort, asc],
  );

  // フィルタ/ソート変更で先頭から再取得(検索語はデバウンス)。初回マウントはSSR結果を使う。
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { offsetRef.current = 0; load(0, true); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  // 無限スクロール(下端の監視)。
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) load(offsetRef.current, false);
    }, { root: el.closest(".sticky-grid"), rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, load]);

  const applyEdit: OnEdited = (id, patch, updatedAt) =>
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch, updated_at: updatedAt } as OppView;
      merged.weighted = Math.round((merged.amount * merged.probability) / 100);
      return merged;
    }));

  // 次回AC（case-tasks）を行から直接 完了/未完了 トグル。楽観更新 + サーバー反映。
  function toggleNextAction(oppId: string, taskId: string, done: boolean) {
    setRows((rs) => rs.map((r) => (r.id === oppId ? ({ ...r, next_action_status: done ? "done" : "open" } as OppView) : r)));
    void toggleTaskDoneAction(taskId, done);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc((a) => !a);
    else { setSort(key); setAsc(ASC_FIRST.includes(key)); }
  }

  return (
    <div className="space-y-4">
      {/* フィルタ */}
      <div className="card card-pad space-y-3">
        <div className="relative max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件名・顧客名で検索" className="input pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <MultiSelect label="ヨミ" options={YOMI_OPTIONS.map((y) => ({ id: y.key, name: y.label }))} selected={yomiSel} onChange={setYomiSel} />
          <Sel value={owner} onChange={setOwner} placeholder="担当営業" options={owners} />
          <Sel value={product} onChange={setProduct} placeholder="商材" options={products} />
          <Sel value={source} onChange={setSource} placeholder="流入経路" options={sources} />
          {campaigns.length > 0 && <Sel value={campaign} onChange={setCampaign} placeholder="展示会・施策" options={campaigns} />}
          <Toggle active={onlyNoNext} onClick={() => setOnlyNoNext((v) => !v)} label="次アクション未設定" />
          <Toggle active={onlyStale} onClick={() => setOnlyStale((v) => !v)} label="放置案件" />
        </div>
        {/* 保存ビュー */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/[0.04]">
          <span className="text-[11px] text-ink/40">保存ビュー:</span>
          {presets.map((p) => (
            <span key={p.id} className="inline-flex items-center rounded-lg border border-black/10 bg-white text-xs">
              <button type="button" onClick={() => applyPreset(p)} className="px-2 py-1 text-ink/70 hover:text-teal-deep font-medium">
                {p.name}{p.is_shared && <span className="text-[9px] text-ink/35 ml-1">共有</span>}
              </button>
              <button type="button" onClick={() => removePreset(p.id)} className="px-1.5 text-ink/25 hover:text-rose-500" title="削除">×</button>
            </span>
          ))}
          <button type="button" onClick={saveCurrentAsPreset} className="text-xs text-teal-deep hover:underline ml-1">＋現在の条件を保存</button>
          <button type="button" onClick={exportCsv} disabled={exporting} className="ml-auto text-xs text-teal-deep hover:underline">
            {exporting ? "出力中…" : "CSV出力（絞込済 全件）"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-ink/60 px-1">
        <span>{total}件</span>
        <span>合計 <b className="text-ink">{formatYen(sumAmount)}</b></span>
        <span>Weighted <b className="text-teal-deep">{formatYen(sumWeighted)}</b></span>
        <span className="text-xs text-ink/35">表示 {rows.length}件</span>
      </div>

      {/* A-6 一括操作バー */}
      {selected.length > 0 && (
        <div className="card card-pad flex items-center gap-3 flex-wrap border-teal-primary/30 bg-teal-light/30">
          <span className="text-sm font-semibold text-teal-deep">{selected.length}件を選択中</span>
          {canReassign && (
            <select
              defaultValue=""
              disabled={bulkBusy}
              onChange={(e) => { runBulk("owner_user_id", e.target.value); e.target.value = ""; }}
              className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">担当を一括変更…</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => { runBulk("yomi", e.target.value); e.target.value = ""; }}
            className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">ヨミを一括変更…</option>
            {YOMI_OPTIONS.filter((y) => !y.key.startsWith("0") && !y.key.startsWith("1")).map((y) => (
              <option key={y.key} value={y.key}>{y.label}</option>
            ))}
          </select>
          <button type="button" onClick={runBulkTask} disabled={bulkBusy} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.02]">
            タスクを一括作成…
          </button>
          {bulkBusy && <Loader2 size={15} className="animate-spin text-teal-deep" />}
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-xs text-ink/45 hover:text-ink">選択解除</button>
        </div>
      )}

      <div className="card">
        <StickyGrid freeze2 maxHeight="66vh">
        <table className="w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className="th w-8">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="accent-teal-primary" aria-label="表示中の案件をすべて選択" />
              </th>
              <SortTh label="顧客 / 案件" onClick={() => toggleSort("name")} active={sort === "name"} asc={asc} />
              <SortTh label="ヨミ" onClick={() => toggleSort("yomi")} active={sort === "yomi"} asc={asc} />
              <SortTh label="担当" onClick={() => toggleSort("owner")} active={sort === "owner"} asc={asc} />
              <SortTh label="商材" onClick={() => toggleSort("product")} active={sort === "product"} asc={asc} />
              <SortTh label="展示会 / 施策" onClick={() => toggleSort("source_detail")} active={sort === "source_detail"} asc={asc} />
              <SortTh label="金額" onClick={() => toggleSort("amount")} active={sort === "amount"} asc={asc} align="right" />
              <SortTh label="ステージ" onClick={() => toggleSort("stage")} active={sort === "stage"} asc={asc} />
              <SortTh label="確度" onClick={() => toggleSort("probability")} active={sort === "probability"} asc={asc} align="right" />
              <SortTh label="商談回数" onClick={() => toggleSort("meeting_count")} active={sort === "meeting_count"} asc={asc} align="right" />
              <SortTh label="直近商談" onClick={() => toggleSort("last_meeting_date")} active={sort === "last_meeting_date"} asc={asc} />
              <SortTh label="受注予定" onClick={() => toggleSort("expected_close_date")} active={sort === "expected_close_date"} asc={asc} />
              <SortTh label="次アクション" onClick={() => toggleSort("next_action_date")} active={sort === "next_action_date"} asc={asc} />
              <th className="th">メモ</th>
              <SortTh label="最終活動" onClick={() => toggleSort("last_activity_at")} active={sort === "last_activity_at"} asc={asc} />
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {rows.map((o) => {
              const since = daysSince(o.last_activity_at);
              return (
                <tr key={o.id} className={cn("row-hover", selected.includes(o.id) && "bg-teal-light/20")}>
                  <td className="td w-8">
                    <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleRow(o.id)} className="accent-teal-primary" aria-label={`${o.name} を選択`} />
                  </td>
                  <td className="td max-w-[240px]">
                    <Link href={`/app/opportunities/${o.id}`} className="block">
                      <span className="font-medium text-ink hover:text-teal-deep truncate block">{o.account?.name}</span>
                      <span className="text-xs text-ink/45 truncate block">{o.name}</span>
                    </Link>
                  </td>
                  <td className="td"><InlineYomi opp={o} onEdited={applyEdit} /></td>
                  <td className="td"><div className="flex items-center gap-1.5"><Avatar user={o.owner} size={22} /><span className="text-xs">{o.owner?.name}</span></div></td>
                  <td className="td text-xs text-ink/70">{o.product?.name ?? "—"}</td>
                  <td className="td text-xs max-w-[150px]">
                    {o.source_detail
                      ? <span className="truncate text-ink/70 block" title={o.source_detail}>{o.source_detail}</span>
                      : o.campaign
                        ? <span className="truncate text-ink/70 block">{o.campaign.name}</span>
                        : <span className="text-ink/30">{o.leadSource?.name ?? "—"}</span>}
                  </td>
                  <td className="td text-right font-semibold tabular-nums"><InlineAmount opp={o} onEdited={applyEdit} /></td>
                  <td className="td"><StageBadge stage={o.stage} /></td>
                  <td className="td text-right tabular-nums">{o.probability}%</td>
                  <td className="td text-right tabular-nums">
                    {o.meeting_count && o.meeting_count > 0
                      ? <span className={cn("pill text-[10px]", o.meeting_count >= 2 ? "bg-teal-light text-teal-deep font-semibold" : "bg-mist-soft text-ink/55")}>{o.meeting_count}回</span>
                      : <span className="text-ink/25 text-xs">0</span>}
                  </td>
                  <td className="td text-xs whitespace-nowrap">{o.last_meeting_date ? formatDate(o.last_meeting_date) : <span className="text-ink/25">—</span>}</td>
                  <td className="td text-xs">{formatDate(o.expected_close_date)}</td>
                  <td className="td">
                    <div className="space-y-1">
                      <InlineNextDate opp={o} onEdited={applyEdit} />
                      {o.next_action_text && (
                        <div className="max-w-[180px] truncate text-[11px] text-ink/55" title={o.next_action_text}>{o.next_action_text}</div>
                      )}
                      {o.next_action_status && (
                        <div className="flex items-center gap-1.5">
                          {o.next_action_task_id && (
                            <TaskCheckbox
                              done={o.next_action_status === "done"}
                              onToggle={(next) => toggleNextAction(o.id, o.next_action_task_id!, next)}
                              size={16}
                            />
                          )}
                          <NextActionStatus status={o.next_action_status} date={o.next_action_date} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="td max-w-[220px]">{o.notes ? <span className="block truncate text-xs text-ink/55" title={o.notes}>{o.notes}</span> : <span className="text-ink/25 text-xs">—</span>}</td>
                  <td className="td"><span className={cn("text-xs", since != null && since >= 7 ? "text-rose-500 font-medium" : "text-ink/50")}>{since != null ? `${since}日前` : "—"}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={15} className="td text-center text-ink/40 py-10">条件に一致する案件がありません</td></tr>
            )}
          </tbody>
        </table>
        {/* 無限スクロールの監視点 */}
        <div ref={sentinel} className="h-10 flex items-center justify-center">
          {loading && <span className="inline-flex items-center gap-2 text-xs text-ink/40"><Loader2 size={14} className="animate-spin" /> 読み込み中…</span>}
          {!loading && !hasMore && rows.length > 0 && <span className="text-[11px] text-ink/30">すべて表示しました</span>}
        </div>
        </StickyGrid>
      </div>
    </div>
  );
}

function Sel({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: Option[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-primary">
      <option value="">{placeholder}：すべて</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("pill border transition-colors", active ? "bg-accent-orange text-white border-accent-orange" : "bg-white text-ink/60 border-black/10")}>{label}</button>
  );
}

function SortTh({ label, onClick, active, asc, align = "left" }: { label: string; onClick: () => void; active: boolean; asc: boolean; align?: "left" | "right" }) {
  return (
    <th className={cn("th cursor-pointer select-none", align === "right" && "text-right")} onClick={onClick}>
      <span className={cn(active && "text-teal-primary")}>{label}{active ? (asc ? " ↑" : " ↓") : ""}</span>
    </th>
  );
}

function MultiSelect({ label, options, selected, onChange }: { label: string; options: Option[]; selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]); }
  const summary = selected.length === 0 ? `${label}：すべて` : `${label}：${selected.length}件`;
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer select-none rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className={selected.length ? "text-teal-deep font-medium" : ""}>{summary}</span>
        <ChevronDown size={13} className="text-ink/40" />
      </summary>
      <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-auto rounded-xl border border-black/10 bg-white shadow-lg p-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-mist-soft rounded-lg cursor-pointer">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} className="accent-teal-primary" />
            {o.name}
          </label>
        ))}
      </div>
    </details>
  );
}
