"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crosshair, EyeOff, Loader2, Settings2, Sparkles } from "lucide-react";
import { AccountSidePanel } from "@/components/accounts/account-side-panel";
import { MatrixFilterBar } from "@/components/accounts/matrix-filter-bar";
import { SegmentEditor } from "@/components/accounts/segment-editor";
import { fetchAccountMatrixAction, listCellAccountsAction } from "@/server/actions/account-panel";
import {
  DEFAULT_SEGMENT_COLOR, DEFAULT_VISIBLE_SEGMENTS, EMPTY_MATRIX_FILTER, MATRIX_RANKS, UNSEGMENTED_KEY,
  buildMatrixFilter, hasMatrixFilter, rankCriteria,
  type AccountMatrix, type MatrixAccount, type MatrixCell, type MatrixFilterState,
} from "@/lib/account-matrix";
import { cn, formatYen } from "@/lib/utils";

/**
 * 顧客分析マトリクス: セグメント(行) × ランク(列)。
 * セルの中に顧客名を並べ、クリックで右ペイン(特大)を開く。
 *
 * セグメントは増える前提なので、既定では上位 DEFAULT_VISIBLE_SEGMENTS 行だけ表示し、
 * 「もっと見る」で残りを開く。行の並び順・表示可否はセグメント設定から変更する。
 *
 * 絞り込みはセルの中身(件数・顧客名)まで変わるので、画面側で隠すのではなく
 * RPC から引き直す。会社名で検索したときは、どのセルに居るかを上部に出す。
 */

/** 行(セグメント)。未分類は id=UNSEGMENTED_KEY の擬似行として最後に置く。 */
interface Row {
  key: string;
  name: string;
  color: string;
  isUnsegmented: boolean;
  /** セグメント設定で非表示にされているが、絞り込み結果に含まれるので出している行 */
  isHidden: boolean;
}

/** 右ペインで連続確認する顧客の並び(セル内の顧客、または検索ヒット) */
interface ActiveList {
  items: { id: string; name: string }[];
}

export function SegmentRankMatrix({
  matrix,
  owners,
  areas,
}: {
  matrix: AccountMatrix;
  owners: { id: string; name: string }[];
  areas: string[];
}) {
  const [filter, setFilter] = useState<MatrixFilterState>(EMPTY_MATRIX_FILTER);
  const [data, setData] = useState<AccountMatrix>(matrix);
  const [loading, setLoading] = useState(false);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeList, setActiveList] = useState<ActiveList | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /** 検索ヒットから開いたセル。該当セルを一時的に強調する */
  const [focusCell, setFocusCell] = useState<string | null>(null);
  /** 「他N社」で追加読込したセルの全件。キーは `${segmentKey}|${rank}` */
  const [expanded, setExpanded] = useState<Record<string, MatrixAccount[]>>({});
  const [loadingCell, setLoadingCell] = useState<string | null>(null);

  const filtering = hasMatrixFilter(filter);
  // 条件オブジェクトは毎回作り直されるので、文字列にして変化したときだけ取り直す
  const filterKey = useMemo(() => JSON.stringify(buildMatrixFilter(filter)), [filter]);

  useEffect(() => {
    // 絞り込みなしのときはサーバコンポーネントが渡してきた初期データをそのまま使う
    if (!filtering) {
      setData(matrix);
      setExpanded({});
      setLoading(false); // 取得中に条件をリセットされた場合に、表示が「絞り込み中…」で止まらないように
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const next = await fetchAccountMatrixAction(JSON.parse(filterKey));
      // 入力が続いて次の取得が始まっている場合は、古い結果で上書きしない
      if (cancelled) return;
      setData(next);
      setExpanded({});
      setActiveList(null);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filterKey, filtering, matrix]);

  const cellMap = useMemo(() => {
    const m = new Map<string, MatrixCell>();
    for (const c of data.cells) m.set(`${c.segmentKey}|${c.rank}`, c);
    return m;
  }, [data.cells]);

  /** セグメントごとの所属顧客数(行の合計に使う。絞り込み後の数) */
  const countsBySegment = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of data.cells) m[c.segmentKey] = (m[c.segmentKey] ?? 0) + c.count;
    return m;
  }, [data.cells]);

  /** 絞り込み無しの社数(「該当N社 ／ 全M社」の分母と、セグメント設定の件数表示) */
  const baseCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of matrix.cells) m[c.segmentKey] = (m[c.segmentKey] ?? 0) + c.count;
    return m;
  }, [matrix.cells]);
  const totalAll = useMemo(() => matrix.cells.reduce((s, c) => s + c.count, 0), [matrix.cells]);
  const totalShown = useMemo(() => data.cells.reduce((s, c) => s + c.count, 0), [data.cells]);

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = data.segments
      // 非表示セグメントも、絞り込み結果に顧客が残っているときは出す(どこに居るか分からなくなるため)
      .filter((s) => s.isVisible || (filtering && (countsBySegment[s.id] ?? 0) > 0))
      .map((s) => ({
        key: s.id,
        name: s.name,
        color: s.color ?? DEFAULT_SEGMENT_COLOR,
        isUnsegmented: false,
        isHidden: !s.isVisible,
      }));
    // 未分類は常に最後(件数が多くても、分類済みの見通しを潰さないため)
    if ((countsBySegment[UNSEGMENTED_KEY] ?? 0) > 0) {
      rows.push({ key: UNSEGMENTED_KEY, name: "未分類", color: "#94A3B8", isUnsegmented: true, isHidden: false });
    }
    return rows;
  }, [data.segments, countsBySegment, filtering]);

  // 絞り込み中は畳まない(ヒットした行が隠れていると探せないため)
  const shownRows = showAllSegments || filtering ? allRows : allRows.slice(0, DEFAULT_VISIBLE_SEGMENTS);
  const hiddenRowCount = allRows.length - shownRows.length;

  /** 非表示セグメントに残っている顧客数(黙って消えたように見えないよう明示する) */
  const hiddenSegmentAccounts = useMemo(() => {
    const shownIds = new Set(allRows.map((r) => r.key));
    return data.segments
      .filter((s) => !shownIds.has(s.id))
      .reduce((sum, s) => sum + (countsBySegment[s.id] ?? 0), 0);
  }, [data.segments, allRows, countsBySegment]);

  const rankTotals = useMemo(
    () =>
      MATRIX_RANKS.map((r) => {
        const cells = data.cells.filter((c) => c.rank === r.key);
        return {
          ...r,
          count: cells.reduce((s, c) => s + c.count, 0),
          won: cells.reduce((s, c) => s + Number(c.won), 0),
        };
      }),
    [data.cells]
  );

  const criteria = useMemo(() => rankCriteria(data.settings), [data.settings]);
  const maxCount = Math.max(1, ...data.cells.map((c) => c.count));
  const matchIds = useMemo(() => new Set(data.matches.map((m) => m.id)), [data.matches]);
  const segmentName = useMemo(() => {
    const m = new Map<string, string>(data.segments.map((s) => [s.id, s.name]));
    m.set(UNSEGMENTED_KEY, "未分類");
    return m;
  }, [data.segments]);

  function accountsFor(cellKey: string, cell: MatrixCell | undefined): MatrixAccount[] {
    return expanded[cellKey] ?? cell?.accounts ?? [];
  }

  /** 「他N社」= セル全件をRPCから追加読込する(マトリクス本体は上位数件しか持たない) */
  async function expandCell(segmentKey: string, rank: string) {
    const cellKey = `${segmentKey}|${rank}`;
    if (expanded[cellKey]) return;
    setLoadingCell(cellKey);
    const r = await listCellAccountsAction({
      segmentKey, rank, offset: 0, limit: 200,
      filter: buildMatrixFilter(filter),
    });
    setLoadingCell(null);
    if (r.ok) setExpanded((p) => ({ ...p, [cellKey]: r.rows }));
  }

  function openList(items: { id: string; name: string }[], index: number) {
    setActiveList({ items });
    setActiveIndex(index);
  }

  /** 検索ヒットから、その顧客が居るセルへ飛ぶ(セルを強調して画面内に入れる) */
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  function jumpToMatch(index: number) {
    const m = data.matches[index];
    if (!m) return;
    const cellKey = `${m.segmentKey}|${m.rank}`;
    setFocusCell(cellKey);
    openList(data.matches.map((x) => ({ id: x.id, name: x.name })), index);
    cellRefs.current[cellKey]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const activeAccount = activeList?.items[activeIndex] ?? null;

  return (
    <div>
      <MatrixFilterBar
        value={filter}
        onChange={setFilter}
        owners={owners}
        areas={areas}
        loading={loading}
        shown={totalShown}
        total={totalAll}
      />

      {/* 会社名検索: どのセルに居るか */}
      {filter.q.trim() !== "" && !loading && (
        <div className="mb-3 rounded-xl border border-teal-primary/30 bg-teal-light/30 px-3 py-2">
          {data.matches.length === 0 ? (
            <p className="text-xs text-ink/55">
              「{filter.q.trim()}」に一致する顧客は見つかりませんでした（他の絞り込みも効いています）。
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-[11px] font-semibold text-teal-deep">
                「{filter.q.trim()}」に一致 {totalShown}社 — クリックでその位置へ
                {totalShown > data.matches.length && (
                  <span className="ml-1 font-normal text-ink/45">（上位{data.matches.length}件を表示）</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.matches.map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => jumpToMatch(i)}
                    className="inline-flex items-center gap-1 rounded-lg border border-teal-primary/30 bg-white px-2 py-1 text-[11px] text-ink/75 hover:border-teal-primary hover:text-teal-deep"
                  >
                    <Crosshair size={10} className="text-teal-primary" />
                    <span className="max-w-[180px] truncate font-medium">{m.name}</span>
                    <span className="text-ink/45">
                      {segmentName.get(m.segmentKey) ?? "未分類"} × {m.rank}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 操作バー */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink/50">
          <span className="font-semibold text-ink/60">ランク基準:</span>
          {MATRIX_RANKS.map((r) => (
            <span key={r.key} className={cn("pill text-[10px] font-bold", r.color)} title={criteria[r.key]}>
              {r.label}
            </span>
          ))}
          <span className="text-ink/40">（バッジにカーソルを合わせると判定条件が出ます）</span>
        </div>
        <button onClick={() => setEditing(true)} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
          <Settings2 size={14} /> セグメント設定
        </button>
      </div>

      {/* マトリクス */}
      <div className={cn("card overflow-x-auto", loading && "opacity-60")}>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-black/[0.06] text-ink/50">
            <tr>
              <th className="th w-44 text-left">セグメント ＼ ランク</th>
              {MATRIX_RANKS.map((r) => (
                <th key={r.key} className="th text-left" title={criteria[r.key]}>
                  <span className={cn("pill text-[10px] font-bold", r.color)}>{r.label}</span>
                </th>
              ))}
              <th className="th w-20 text-right">計</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-black/[0.04]">
            {shownRows.map((row) => (
              <tr key={row.key} className="align-top">
                <td className="td">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                    <span className={cn("font-semibold", row.isUnsegmented && "text-ink/50")}>{row.name}</span>
                    {row.isHidden && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] text-ink/35" title="セグメント設定で非表示。絞り込み結果に含まれるため表示しています">
                        <EyeOff size={9} /> 非表示
                      </span>
                    )}
                  </div>
                  <span className="block pl-[18px] text-[10px] text-ink/40 tabular-nums">
                    {countsBySegment[row.key] ?? 0}社
                  </span>
                </td>

                {MATRIX_RANKS.map((r) => {
                  const cellKey = `${row.key}|${r.key}`;
                  const cell = cellMap.get(cellKey);
                  const accounts = accountsFor(cellKey, cell);
                  const count = cell?.count ?? 0;
                  const remaining = count - accounts.length;

                  return (
                    <td
                      key={r.key}
                      ref={(el) => { cellRefs.current[cellKey] = el; }}
                      className={cn("td", focusCell === cellKey && "ring-2 ring-inset ring-accent-orange")}
                      style={{ backgroundColor: count > 0 ? `rgba(0,140,140,${0.05 + 0.22 * (count / maxCount)})` : undefined }}
                    >
                      {count === 0 ? (
                        <span className="text-ink/20">—</span>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xs font-bold tabular-nums text-ink/80">{count}社</span>
                            {Number(cell?.won ?? 0) > 0 && (
                              <span className="text-[10px] tabular-nums text-ink/45">{formatYen(Number(cell?.won))}</span>
                            )}
                          </div>

                          <ul className="space-y-0.5">
                            {accounts.map((acc, i) => (
                              <li key={acc.id}>
                                <button
                                  onClick={() => openList(accounts.map((a) => ({ id: a.id, name: a.name })), i)}
                                  title={accountTitle(acc)}
                                  className={cn(
                                    "block w-full truncate rounded px-1 py-px text-left text-xs text-ink/80 hover:bg-white/70 hover:text-teal-primary hover:underline",
                                    matchIds.has(acc.id) && "bg-accent-orange/15 font-semibold text-ink"
                                  )}
                                >
                                  {acc.name}
                                  {acc.rankAuto && <Sparkles size={9} className="ml-0.5 -mt-0.5 inline text-ink/25" />}
                                </button>
                              </li>
                            ))}
                          </ul>

                          {remaining > 0 && (
                            <button
                              onClick={() => void expandCell(row.key, r.key)}
                              disabled={loadingCell === cellKey}
                              className="inline-flex items-center gap-1 px-1 text-[10px] font-semibold text-teal-primary hover:underline disabled:opacity-60"
                            >
                              {loadingCell === cellKey ? <Loader2 size={10} className="animate-spin" /> : <ChevronDown size={10} />}
                              他{remaining}社
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}

                <td className="td text-right text-sm font-bold tabular-nums">{countsBySegment[row.key] ?? 0}</td>
              </tr>
            ))}

            {allRows.length === 0 && (
              <tr>
                <td colSpan={MATRIX_RANKS.length + 2} className="td py-8 text-center text-ink/40">
                  {filtering
                    ? "条件に一致する顧客がありません。絞り込みを緩めてください。"
                    : "表示できるセグメントがありません。「セグメント設定」から追加・表示してください。"}
                </td>
              </tr>
            )}
          </tbody>

          <tfoot className="border-t border-black/[0.08] bg-mist-soft/40">
            <tr>
              <td className="td font-semibold">合計</td>
              {rankTotals.map((r) => (
                <td key={r.key} className="td text-sm font-semibold tabular-nums">
                  {r.count}社
                  {r.won > 0 && <span className="block text-[10px] font-normal text-ink/45">{formatYen(r.won)}</span>}
                </td>
              ))}
              <td className="td text-right font-bold tabular-nums">
                {rankTotals.reduce((s, r) => s + r.count, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* もっと見る */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!filtering && allRows.length > DEFAULT_VISIBLE_SEGMENTS && (
          <button
            onClick={() => setShowAllSegments((v) => !v)}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            {showAllSegments ? (
              <><ChevronUp size={14} /> 上位{DEFAULT_VISIBLE_SEGMENTS}件だけ表示</>
            ) : (
              <><ChevronDown size={14} /> もっと見る（残り{hiddenRowCount}セグメント）</>
            )}
          </button>
        )}
        {hiddenSegmentAccounts > 0 && (
          <span className="text-[11px] text-ink/45">
            非表示セグメントに {hiddenSegmentAccounts}社。「セグメント設定」から表示できます。
          </span>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink/40">
        セルの濃さは社数。顧客名をクリックすると右側に詳細が開きます（
        <Sparkles size={9} className="inline -mt-0.5" /> はランク自動判定＝手動未設定）。
        セグメントは顧客の「業種」から自動でマッピングし、右ペインで個別に固定できます。
      </p>

      {/* 右ペイン(特大) */}
      <AccountSidePanel
        accountId={activeAccount?.id ?? null}
        segments={data.segments}
        index={activeIndex}
        total={activeList?.items.length ?? 0}
        onClose={() => { setActiveList(null); setFocusCell(null); }}
        onNav={(dir) =>
          setActiveIndex((i) => {
            const next = i + dir;
            const max = (activeList?.items.length ?? 1) - 1;
            return next < 0 ? 0 : next > max ? max : next;
          })
        }
      />

      {editing && (
        <SegmentEditor
          segments={data.segments}
          settings={data.settings}
          counts={baseCounts}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/** セル内の顧客名のツールチップ。規模・取引額・最終受注をまとめて出す。 */
function accountTitle(a: MatrixAccount): string {
  const parts = [a.name];
  if (a.industry) parts.push(`業種 ${a.industry}`);
  if (a.ownerName) parts.push(`担当 ${a.ownerName}`);
  if (a.employees) parts.push(`規模 ${a.employees.toLocaleString("ja-JP")}名〜`);
  parts.push(`累計受注 ${formatYen(a.won)}`);
  if (a.lastWonDate) parts.push(`最終受注 ${a.lastWonDate}`);
  return parts.join("｜");
}
