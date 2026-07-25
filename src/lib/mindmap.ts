/**
 * マインドマップの純ロジック(サーバー/クライアント/テスト共通)。
 * docs/MINDMAP_DESIGN_2026-07.md
 *
 *  - ツリー構築(buildTree)
 *  - レイアウト(layoutMindmap): 古典的な tidy tree。子の高さを積み上げ、親を子群の中心へ。
 *  - Markdown 入出力(toMarkdown / parseMarkdown)
 *  - 保存前の整合性検証(validateNodes)
 *
 * 外部ライブラリ非依存。ここが壊れると全画面が壊れるので tests/mindmap.test.ts で回帰を張る。
 */

export type MindmapKind = "weekly_plan" | "seminar" | "freeform";
export type MindmapLayout = "right" | "both";
export type NodeMarker = "none" | "p1" | "p2" | "p3" | "flag" | "alert" | "star" | "done";
export type NodeStatus = "none" | "todo" | "doing" | "done";
export type NodeRefType = "none" | "opportunity" | "account" | "task" | "meeting" | "calendar";

export interface MindmapNode {
  id: string;
  parent_id: string | null;
  title: string;
  note: string | null;
  sort_order: number;
  collapsed: boolean;
  color: string | null;
  marker: NodeMarker;
  status: NodeStatus;
  due_date: string | null;
  ref_type: NodeRefType;
  ref_id: string | null;
  ref_url: string | null;
}

export interface MindmapLink {
  id: string;
  from_node_id: string;
  to_node_id: string;
  label: string | null;
}

export interface MindmapMeta {
  id: string;
  title: string;
  kind: MindmapKind;
  source: "manual" | "auto";
  period_start: string | null;
  layout: MindmapLayout;
  note: string | null;
  updated_at: string;
  created_at: string;
}

export interface TreeNode extends MindmapNode {
  depth: number;
  children: TreeNode[];
}

/* ------------------------------------------------------------------ */
/* パレット                                                            */
/* ------------------------------------------------------------------ */

/** 第1階層の枝に自動で割り当てる色(子は継承)。CATORCEデザインガイド寄りの落ち着いた配色。 */
export const BRANCH_COLORS = [
  "#008C8C", // teal primary
  "#F59A2A", // accent orange
  "#3B6FD4", // blue
  "#C2434F", // red
  "#6C4FB8", // purple
  "#2F9E6B", // green
  "#B4761F", // amber deep
  "#4A7C90", // slate teal
] as const;

export const MARKER_LABELS: Record<NodeMarker, string> = {
  none: "なし",
  p1: "優先度1",
  p2: "優先度2",
  p3: "優先度3",
  flag: "フラグ",
  alert: "要注意",
  star: "重要",
  done: "完了",
};

export const STATUS_LABELS: Record<NodeStatus, string> = {
  none: "—",
  todo: "未着手",
  doing: "進行中",
  done: "完了",
};

/** マーカーのバッジ表示(記号と色)。 */
export function markerBadge(marker: NodeMarker): { text: string; bg: string } | null {
  switch (marker) {
    case "p1":
      return { text: "1", bg: "#C2434F" };
    case "p2":
      return { text: "2", bg: "#F59A2A" };
    case "p3":
      return { text: "3", bg: "#3B6FD4" };
    case "flag":
      return { text: "⚑", bg: "#C2434F" };
    case "alert":
      return { text: "!", bg: "#C2434F" };
    case "star":
      return { text: "★", bg: "#F59A2A" };
    case "done":
      return { text: "✓", bg: "#2F9E6B" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* ツリー構築                                                          */
/* ------------------------------------------------------------------ */

/** ルート(parent_id=null)を1つ返す。孤児ノードはルート直下に寄せて救済する。 */
export function buildTree(nodes: MindmapNode[]): TreeNode | null {
  if (nodes.length === 0) return null;
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, depth: 0, children: [] });

  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (!parent || parent.id === n.id) roots.push(n);
    else parent.children.push(n);
  }
  // 先頭のルートを正とし、残り(孤児)はその子として救済
  const root = roots.sort((a, b) => a.sort_order - b.sort_order)[0];
  for (const r of roots) if (r !== root) root.children.push(r);

  const sortRec = (node: TreeNode, depth: number, seen: Set<string>) => {
    node.depth = depth;
    if (seen.has(node.id)) {
      node.children = []; // 循環の保険(通常は validateNodes で弾く)
      return;
    }
    seen.add(node.id);
    node.children.sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    for (const c of node.children) sortRec(c, depth + 1, seen);
  };
  sortRec(root, 0, new Set());
  return root;
}

/** 子孫の総数(折り畳みバッジ用)。 */
export function countDescendants(node: TreeNode): number {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

/** 自分と子孫のIDを集める(サブツリー削除・ドロップ先の禁止判定)。 */
export function subtreeIds(nodes: MindmapNode[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = childrenOf.get(n.parent_id) ?? [];
    list.push(n.id);
    childrenOf.set(n.parent_id, list);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const c of childrenOf.get(id) ?? []) walk(c);
  };
  walk(rootId);
  return out;
}

/* ------------------------------------------------------------------ */
/* レイアウト                                                          */
/* ------------------------------------------------------------------ */

export interface LayoutOptions {
  layout?: MindmapLayout;
  hGap?: number;
  vGap?: number;
}

export interface PositionedNode {
  node: TreeNode;
  /** 左上座標 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 中心Y(エッジ接続点) */
  cy: number;
  /** 親から見た方向。both レイアウトで左側の枝は -1。 */
  dir: 1 | -1;
  color: string;
  hiddenChildren: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  /** 親側の接続点 */
  x1: number;
  y1: number;
  /** 子側の接続点 */
  x2: number;
  y2: number;
  color: string;
  dir: 1 | -1;
}

export interface LayoutResult {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  byId: Map<string, PositionedNode>;
  width: number;
  height: number;
  minX: number;
  minY: number;
}

const NODE_PAD_X = 14;
const NODE_PAD_Y = 8;
const LINE_H = 20;
const FONT = 13.5;
const MAX_TEXT_W = 220;
const MIN_TEXT_W = 40;

/** 日本語混在テキストの概算幅(全角=1.0 / 半角=0.55 文字ぶん)。 */
export function textWidth(text: string, font = FONT): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code < 0x2e80 && code !== 0x2014 ? 0.55 : 1;
  }
  return units * font;
}

/** 折り返し後の行数(概算)。 */
export function textLines(text: string): number {
  const explicit = text.split("\n");
  let lines = 0;
  for (const part of explicit) lines += Math.max(1, Math.ceil(textWidth(part) / MAX_TEXT_W));
  return Math.max(1, lines);
}

/** ノードの箱サイズ。マーカー/期日バッジのぶんを加味する。 */
export function nodeSize(node: MindmapNode): { w: number; h: number } {
  const title = node.title || "（無題）";
  const textW = Math.min(MAX_TEXT_W, Math.max(MIN_TEXT_W, textWidth(title)));
  const lines = textLines(title);
  const extra = (markerBadge(node.marker) ? 22 : 0) + (node.due_date ? 42 : 0) + (node.note ? 16 : 0);
  return {
    w: Math.round(textW + NODE_PAD_X * 2 + extra),
    h: Math.round(lines * LINE_H + NODE_PAD_Y * 2),
  };
}

/**
 * ツリーを配置する。
 * 右方向(right)が既定。both は第1階層を上半分=右 / 下半分=左 に振り分けて鏡像配置。
 */
export function layoutMindmap(root: TreeNode | null, opts: LayoutOptions = {}): LayoutResult {
  const hGap = opts.hGap ?? 56;
  const vGap = opts.vGap ?? 14;
  const positioned: PositionedNode[] = [];
  const edges: LayoutEdge[] = [];
  const byId = new Map<string, PositionedNode>();

  if (!root) {
    return { nodes: [], edges: [], byId, width: 0, height: 0, minX: 0, minY: 0 };
  }

  /** 方向つきで1つの枝を配置し、占有した高さを返す。 */
  const place = (
    node: TreeNode,
    anchorX: number, // 親の枝が伸びる基準X(dir=1なら左端、dir=-1なら右端)
    top: number,
    dir: 1 | -1,
    color: string,
  ): { entry: PositionedNode; height: number } => {
    const { w, h } = nodeSize(node);
    const x = dir === 1 ? anchorX : anchorX - w;
    const visibleChildren = node.collapsed ? [] : node.children;

    const entry: PositionedNode = {
      node,
      x,
      y: top,
      w,
      h,
      cy: top + h / 2,
      dir,
      color,
      hiddenChildren: node.collapsed ? countDescendants(node) : 0,
    };

    if (visibleChildren.length === 0) {
      positioned.push(entry);
      byId.set(node.id, entry);
      return { entry, height: h };
    }

    const childAnchor = dir === 1 ? x + w + hGap : x - hGap;
    const childEntries: PositionedNode[] = [];
    let cursor = top;
    let total = 0;
    for (const child of visibleChildren) {
      // 色は第1階層(ルートの子)で決まり、以降の子孫は継承する(X-mindと同じ見え方)
      const r = place(child, childAnchor, cursor, dir, color);
      childEntries.push(r.entry);
      cursor += r.height + vGap;
      total += r.height + vGap;
    }
    total = Math.max(0, total - vGap);

    // 親は子群の中心へ。子群が親より低いときは子側を下げて中央を合わせる。
    if (total < h) {
      const shift = (h - total) / 2;
      for (const c of childEntries) shiftSubtree(c, shift, positioned);
      total = h;
    }
    const first = childEntries[0];
    const last = childEntries[childEntries.length - 1];
    const center = (first.cy + last.cy) / 2;
    entry.y = center - h / 2;
    entry.cy = center;

    positioned.push(entry);
    byId.set(node.id, entry);

    for (const c of childEntries) {
      edges.push({
        fromId: node.id,
        toId: c.node.id,
        x1: dir === 1 ? entry.x + entry.w : entry.x,
        y1: entry.cy,
        x2: dir === 1 ? c.x : c.x + c.w,
        y2: c.cy,
        color: c.color,
        dir,
      });
    }
    return { entry, height: total };
  };

  // both レイアウト: ルート直下を左右に振り分ける
  const rootSize = nodeSize(root);
  const rootEntry: PositionedNode = {
    node: root,
    x: 0,
    y: 0,
    w: rootSize.w,
    h: rootSize.h,
    cy: rootSize.h / 2,
    dir: 1,
    color: "#0D2828",
    hiddenChildren: root.collapsed ? countDescendants(root) : 0,
  };

  const children = root.collapsed ? [] : root.children;
  const useBoth = opts.layout === "both" && children.length > 1;
  const rightChildren = useBoth ? children.slice(0, Math.ceil(children.length / 2)) : children;
  const leftChildren = useBoth ? children.slice(Math.ceil(children.length / 2)) : [];

  const placeSide = (list: TreeNode[], dir: 1 | -1, startIndex: number) => {
    const anchor = dir === 1 ? rootEntry.x + rootEntry.w + hGap : rootEntry.x - hGap;
    const entries: PositionedNode[] = [];
    let cursor = 0;
    for (const child of list) {
      const color = nextBranchColor(startIndex + entries.length);
      const r = place(child, anchor, cursor, dir, color);
      entries.push(r.entry);
      cursor += r.height + vGap;
    }
    return entries;
  };

  const rightEntries = placeSide(rightChildren, 1, 0);
  const leftEntries = placeSide(leftChildren, -1, rightChildren.length);

  // ルートを左右の子群の中心に合わせる
  const all = [...rightEntries, ...leftEntries];
  if (all.length > 0) {
    const top = Math.min(...all.map((e) => e.y));
    const bottom = Math.max(...all.map((e) => e.y + e.h));
    rootEntry.cy = (top + bottom) / 2;
    rootEntry.y = rootEntry.cy - rootEntry.h / 2;
  }
  positioned.push(rootEntry);
  byId.set(root.id, rootEntry);

  for (const c of all) {
    edges.push({
      fromId: root.id,
      toId: c.node.id,
      x1: c.dir === 1 ? rootEntry.x + rootEntry.w : rootEntry.x,
      y1: rootEntry.cy,
      x2: c.dir === 1 ? c.x : c.x + c.w,
      y2: c.cy,
      color: c.color,
      dir: c.dir,
    });
  }

  const minX = Math.min(...positioned.map((p) => p.x));
  const minY = Math.min(...positioned.map((p) => p.y));
  const maxX = Math.max(...positioned.map((p) => p.x + p.w));
  const maxY = Math.max(...positioned.map((p) => p.y + p.h));

  return {
    nodes: positioned,
    edges,
    byId,
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
  };
}

function nextBranchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length];
}

/** 配置済みサブツリーを縦にずらす(親中央合わせの調整)。 */
function shiftSubtree(entry: PositionedNode, dy: number, positioned: PositionedNode[]) {
  const ids = new Set<string>();
  const walk = (n: TreeNode) => {
    ids.add(n.id);
    if (!n.collapsed) for (const c of n.children) walk(c);
  };
  walk(entry.node);
  for (const p of positioned) {
    if (!ids.has(p.node.id)) continue;
    p.y += dy;
    p.cy += dy;
  }
}

/* ------------------------------------------------------------------ */
/* 可視範囲(カリング)                                                  */
/* ------------------------------------------------------------------ */

export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

export interface VisibleBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 画面に映っているキャンバス座標の範囲を求める。
 *
 * 週次マップは数百ノード・縦2万pxに達することがある。全ノードをDOMに置くと
 * ホイールのたびに全件を再レンダリングして固まり、さらに巨大要素へ transform:scale が
 * 掛かることでラスタライズ用メモリがGB級に膨らみ、タブごと落ちる。
 * そこでこの範囲に入るものだけを描画する。
 */
export function visibleBox(
  view: ViewTransform,
  viewportW: number,
  viewportH: number,
  origin: { x: number; y: number },
  margin = 400,
): VisibleBox {
  return {
    x0: -view.tx / view.scale - origin.x - margin,
    y0: -view.ty / view.scale - origin.y - margin,
    x1: (viewportW - view.tx) / view.scale - origin.x + margin,
    y1: (viewportH - view.ty) / view.scale - origin.y + margin,
  };
}

/** ノードの矩形が可視範囲と交差するか。 */
export function nodeInBox(box: VisibleBox, p: { x: number; y: number; w: number; h: number }): boolean {
  return p.x < box.x1 && p.x + p.w > box.x0 && p.y < box.y1 && p.y + p.h > box.y0;
}

/** エッジの外接矩形が可視範囲と交差するか。 */
export function edgeInBox(box: VisibleBox, e: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return (
    Math.min(e.x1, e.x2) < box.x1 &&
    Math.max(e.x1, e.x2) > box.x0 &&
    Math.min(e.y1, e.y2) < box.y1 &&
    Math.max(e.y1, e.y2) > box.y0
  );
}

/* ------------------------------------------------------------------ */
/* Markdown 入出力                                                     */
/* ------------------------------------------------------------------ */

/** インデント箇条書きの Markdown に変換(コピー用)。 */
export function toMarkdown(root: TreeNode | null): string {
  if (!root) return "";
  const lines: string[] = [`# ${root.title}`];
  const walk = (node: TreeNode, depth: number) => {
    for (const c of node.children) {
      const marker = markerBadge(c.marker);
      const badge = marker ? ` [${marker.text}]` : "";
      const due = c.due_date ? ` (${c.due_date})` : "";
      lines.push(`${"  ".repeat(depth)}- ${c.title}${badge}${due}`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n");
}

export interface ParsedNode {
  title: string;
  children: ParsedNode[];
}

/**
 * インデント箇条書き(または見出し)の Markdown をツリーに変換(貼り付け取込用)。
 * 「- 項目」「* 項目」「# 見出し」「タブ/スペースインデント」に対応。
 */
export function parseMarkdown(text: string): ParsedNode[] {
  const rootList: ParsedNode[] = [];
  const stack: { indent: number; node: ParsedNode }[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    let indent: number;
    let title: string;
    if (heading) {
      indent = heading[1].length - 1;
      title = heading[2].trim();
    } else {
      const m = raw.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
      if (!m) {
        const plain = raw.match(/^(\s*)(.*)$/);
        if (!plain) continue;
        indent = Math.floor(plain[1].replace(/\t/g, "  ").length / 2);
        title = plain[2].trim();
      } else {
        indent = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        title = m[2].trim();
      }
    }
    if (!title) continue;

    const node: ParsedNode = { title: title.slice(0, 200), children: [] };
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length === 0) rootList.push(node);
    else stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  return rootList;
}

/* ------------------------------------------------------------------ */
/* 保存前の検証                                                        */
/* ------------------------------------------------------------------ */

export const MAX_NODES = 2000;
export const MAX_TITLE = 200;

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * スナップショット保存の前提を検証する。
 *  - 件数上限 / ルートが1つ / 親が同じ集合に存在 / 循環なし
 * サーバー側で必ず通す(クライアントのバグや細工した入力をDBに入れない)。
 */
export function validateNodes(nodes: { id: string; parent_id: string | null }[]): ValidationResult {
  if (nodes.length === 0) return { ok: false, error: "ノードが空です" };
  if (nodes.length > MAX_NODES) return { ok: false, error: `ノードが多すぎます(上限${MAX_NODES})` };

  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) return { ok: false, error: "ノードIDが重複しています" };
    ids.add(n.id);
  }
  const roots = nodes.filter((n) => !n.parent_id);
  if (roots.length !== 1) return { ok: false, error: "ルートは1つでなければなりません" };

  const parentOf = new Map<string, string | null>(nodes.map((n) => [n.id, n.parent_id]));
  for (const n of nodes) {
    if (n.parent_id && !ids.has(n.parent_id)) return { ok: false, error: "親が存在しないノードがあります" };
  }
  // 循環検出: 各ノードからルートへ辿れること
  for (const n of nodes) {
    let cur: string | null = n.id;
    let hops = 0;
    while (cur) {
      cur = parentOf.get(cur) ?? null;
      if (++hops > nodes.length) return { ok: false, error: "ノードが循環しています" };
    }
  }
  return { ok: true };
}

/** 空タイトルなどを整えた保存用の行に正規化する。 */
export function normalizeNode(n: MindmapNode): MindmapNode {
  return {
    ...n,
    title: (n.title ?? "").slice(0, MAX_TITLE),
    note: n.note ? n.note.slice(0, 5000) : null,
    sort_order: Number.isFinite(n.sort_order) ? Math.trunc(n.sort_order) : 0,
  };
}
