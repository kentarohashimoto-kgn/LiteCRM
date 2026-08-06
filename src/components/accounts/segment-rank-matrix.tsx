"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Settings2, Sparkles } from "lucide-react";
import { AccountSidePanel } from "@/components/accounts/account-side-panel";
import { SegmentEditor } from "@/components/accounts/segment-editor";
import { listCellAccountsAction } from "@/server/actions/account-panel";
import {
  DEFAULT_SEGMENT_COLOR, DEFAULT_VISIBLE_SEGMENTS, MATRIX_RANKS, UNSEGMENTED_KEY,
  rankCriteria,
  type AccountMatrix, type MatrixAccount, type MatrixCell,
} from "@/lib/account-matrix";
import { cn, formatYen } from "@/lib/utils";

/**
 * 顧客分析マトリクス: セグメント(行) × ランク(列)。
 * セルの中に顧客名を並べ、クリックで右ペイン(特大)を開く。
 *
 * セグメントは増える前提なので、既定では上位 DEFAULT_VISIBLE_SEGMENTS 行だけ表示し、
 * 「もっと見る」で残りを開く。行の並び順・表示可否はセグメント設定から変更する。
 */

/** 行(セグメント)。未分類は id=UNSEGMENTED_KEY の擬似行として最後に置く。 */
interface Row {
  key: string;
  name: string;
  color: string;
  isUnsegmented: boolean;
}

/** 開いているセル(顧客の連続確認に使う) */
interface ActiveCell {
  segmentKey: string;
  rank: string;
  accounts: MatrixAccount[];
}

export function SegmentRankMatrix({ matrix }: { matrix: AccountMatrix }) {
  const [showAllSegments, setShowAllSegments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /** 「他N社」で追加読込したセルの全件。キーは `${segmentKey}|${rank}` */
  const [expanded, setExpanded] = useState<Record<string, MatrixAccount[]>>({});
  const [loadingCell, setLoadingCell] = useState<string | null>(null);

  const cellMap = useMemo(() => {
    const m = new Map<string, MatrixCell>();
    for (const c of matrix.cells) m.set(`${c.segmentKey}|${c.rank}`, c);
    return m;
  }, [matrix.cells]);

  /** セグメントごとの所属顧客数(設定パネルの表示と、行の合計に使う) */
  const countsBySegment = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of matrix.cells) m[c.segmentKey] = (m[c.segmentKey] ?? 0) + c.count;
    return m;
  }, [matrix.cells]);

  const visibleSegments = useMemo(() => matrix.segments.filter((s) => s.isVisible), [matrix.segments]);

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = visibleSegments.map((s) => ({
      key: s.id,
      name: s.name,
      color: s.color ?? DEFAULT_SEGMENT_COLOR,
      isUnsegmented: false,
    }));
    // 未分類は常に最後(件数が多くても、分類済みの見通しを潰さないため)
    if ((countsBySegment[UNSEGMENTED_KEY] ?? 0) > 0) {
      rows.push({ key: UNSEGMENTED_KEY, name: "未分類", color: "#94A3B8", isUnsegmented: true });
    }
    return rows;
  }, [visibleSegments, countsBySegment]);

  const shownRows = showAllSegments ? allRows : allRows.slice(0, DEFAULT_VISIBLE_SEGMENTS);
  const hiddenRowCount = allRows.length - shownRows.length;

  /** 非表示セグメントに残っている顧客数(黙って消えたように見えないよう明示する) */
  const hiddenSegmentAccounts = useMemo(() => {
    const visibleIds = new Set(visibleSegments.map((s) => s.id));
    return matrix.segments
      .filter((s) => !visibleIds.has(s.id))
      .reduce((sum, s) => sum + (countsBySegment[s.id] ?? 0), 0);
  }, [matrix.segments, visibleSegments, countsBySegment]);

  const rankTotals = useMemo(
    () =>
      MATRIX_RANKS.map((r) => {
        const cells = matrix.cells.filter((c) => c.rank === r.key);
        return {
          ...r,
          count: cells.reduce((s, c) => s + c.count, 0),
          won: cells.reduce((s, c) => s + Number(c.won), 0),
        };
      }),
    [matrix.cells]
  );

  const criteria = useMemo(() => rankCriteria(matrix.settings), [matrix.settings]);
  const maxCount = Math.max(1, ...matrix.cells.map((c) => c.count));

  function accountsFor(cellKey: string, cell: MatrixCell | undefined): MatrixAccount[] {
    return expanded[cellKey] ?? cell?.accounts ?? [];
  }

  /** 「他N社」= セル全件をRPCから追加読込する(マトリクス本体は上位数件しか持たない) */
  async function expandCell(segmentKey: string, rank: string) {
    const cellKey = `${segmentKey}|${rank}`;
    if (expanded[cellKey]) return;
    setLoadingCell(cellKey);
    const r = await listCellAccountsAction({ segmentKey, rank, offset: 0, limit: 200 });
    setLoadingCell(null);
    if (r.ok) setExpanded((p) => ({ ...p, [cellKey]: r.rows }));
  }

  function openAccount(segmentKey: string, rank: string, accounts: MatrixAccount[], index: number) {
    setActiveCell({ segmentKey, rank, accounts });
    setActiveIndex(index);
  }

  const activeAccount = activeCell?.accounts[activeIndex] ?? null;

  return (
    <div>
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
      <div className="card overflow-x-auto">
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
                      className="td"
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
                                  onClick={() => openAccount(row.key, r.key, accounts, i)}
                                  title={`${acc.name}${acc.industry ? `（${acc.industry}）` : ""}｜累計受注 ${formatYen(acc.won)}`}
                                  className="block w-full truncate rounded px-1 py-px text-left text-xs text-ink/80 hover:bg-white/70 hover:text-teal-primary hover:underline"
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
                  表示できるセグメントがありません。「セグメント設定」から追加・表示してください。
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
        {allRows.length > DEFAULT_VISIBLE_SEGMENTS && (
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
        segments={matrix.segments}
        index={activeIndex}
        total={activeCell?.accounts.length ?? 0}
        onClose={() => setActiveCell(null)}
        onNav={(dir) =>
          setActiveIndex((i) => {
            const next = i + dir;
            const max = (activeCell?.accounts.length ?? 1) - 1;
            return next < 0 ? 0 : next > max ? max : next;
          })
        }
      />

      {editing && (
        <SegmentEditor
          segments={matrix.segments}
          settings={matrix.settings}
          counts={countsBySegment}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
