"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  CornerDownRight,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  Copy,
  ClipboardPaste,
  Sparkles,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  ChevronRight,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import {
  BRANCH_COLORS,
  MARKER_LABELS,
  STATUS_LABELS,
  buildTree,
  edgeInBox,
  layoutMindmap,
  markerBadge,
  nodeInBox,
  parseMarkdown,
  subtreeIds,
  toMarkdown,
  visibleBox,
  type MindmapLayout,
  type MindmapLink,
  type MindmapMeta,
  type MindmapNode,
  type NodeMarker,
  type NodeStatus,
  type ParsedNode,
} from "@/lib/mindmap";
import { saveMindmapSnapshotAction, suggestChildNodesAction, updateMindmapMetaAction } from "@/server/actions/mindmaps";
import { cn } from "@/lib/utils";

/**
 * マインドマップ・エディタ(管理者専用)。
 * HTMLノード(絶対配置) + SVGエッジ を transform でパン/ズームする。追加ライブラリなし。
 *
 * 操作: Tab=子追加 / Enter=兄弟追加 / F2・ダブルクリック=編集 / Delete=削除
 *       ↑↓←→=選択移動 / Ctrl+↑↓=並び替え / Space=折り畳み / Ctrl+Z・Ctrl+Shift+Z=Undo/Redo
 *       ドラッグ&ドロップ=親の付け替え / ホイール=パン / Ctrl+ホイール=ズーム
 */

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Snapshot {
  nodes: MindmapNode[];
  links: MindmapLink[];
}

const PAD = 48;
/** 可視範囲の外側にこの余白ぶんだけ余分に描く(スクロール時のちらつき防止)。 */
const CULL_MARGIN = 400;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2.5;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // 保険(古い環境): 衝突しない程度のランダムUUID v4形式
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function blankNode(parentId: string | null, sortOrder: number): MindmapNode {
  return {
    id: uid(),
    parent_id: parentId,
    title: "",
    note: null,
    sort_order: sortOrder,
    collapsed: false,
    color: null,
    marker: "none",
    status: "none",
    due_date: null,
    ref_type: "none",
    ref_id: null,
    ref_url: null,
  };
}

export function MindmapCanvas({
  meta,
  initialNodes,
  initialLinks,
}: {
  meta: MindmapMeta;
  initialNodes: MindmapNode[];
  initialLinks: MindmapLink[];
}) {
  const [nodes, setNodes] = useState<MindmapNode[]>(initialNodes);
  const [links, setLinks] = useState<MindmapLink[]>(initialLinks);
  const [layoutMode, setLayoutMode] = useState<MindmapLayout>(meta.layout);
  const [selectedId, setSelectedId] = useState<string | null>(initialNodes.find((n) => !n.parent_id)?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showInspector, setShowInspector] = useState(true);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // 表示変換(パン・ズーム)
  const [view, setView] = useState({ tx: 24, ty: 24, scale: 1 });
  const [viewportSize, setViewportSize] = useState({ w: 1200, h: 700 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // パン・ズームは1フレーム1回に間引く(ホイールは秒間100回近く発火するため)
  const viewRef = useRef(view);
  viewRef.current = view;
  const rafRef = useRef<number | null>(null);
  const pendingView = useRef<typeof view | null>(null);

  const applyView = useCallback((updater: (v: { tx: number; ty: number; scale: number }) => { tx: number; ty: number; scale: number }) => {
    pendingView.current = updater(pendingView.current ?? viewRef.current);
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const next = pendingView.current;
      pendingView.current = null;
      if (next) setView(next);
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ビューポート実寸(可視範囲の計算に使う)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewportSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Undo/Redo 履歴
  const history = useRef<Snapshot[]>([{ nodes: initialNodes, links: initialLinks }]);
  const hIndex = useRef(0);
  const skipSave = useRef(true);

  /* ---------------- 派生データ ---------------- */

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const layout = useMemo(() => layoutMindmap(tree, { layout: layoutMode }), [tree, layoutMode]);
  const origin = useMemo(() => ({ x: -layout.minX + PAD, y: -layout.minY + PAD }), [layout]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  // 可視範囲だけを描く(カリング)。詳細は lib/mindmap.ts の visibleBox() を参照。
  const viewBox = useMemo(
    () => visibleBox(view, viewportSize.w, viewportSize.h, origin, CULL_MARGIN),
    [view, origin, viewportSize],
  );

  const visibleNodes = useMemo(
    () =>
      layout.nodes.filter(
        (p) =>
          // 編集中・選択中のノードは画面外でもDOMに残す(フォーカスと操作対象を失わないため)
          p.node.id === editingId || p.node.id === selectedId || nodeInBox(viewBox, p),
      ),
    [layout.nodes, viewBox, editingId, selectedId],
  );

  const visibleEdges = useMemo(
    () => layout.edges.filter((e) => edgeInBox(viewBox, e)),
    [layout.edges, viewBox],
  );

  const childrenOf = useMemo(() => {
    const m = new Map<string, MindmapNode[]>();
    for (const n of nodes) {
      if (!n.parent_id) continue;
      const list = m.get(n.parent_id) ?? [];
      list.push(n);
      m.set(n.parent_id, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [nodes]);

  /* ---------------- 変更コミット(履歴つき) ---------------- */

  const commit = useCallback((nextNodes: MindmapNode[], nextLinks?: MindmapLink[]) => {
    const snapshot: Snapshot = { nodes: nextNodes, links: nextLinks ?? history.current[hIndex.current].links };
    history.current = [...history.current.slice(0, hIndex.current + 1), snapshot].slice(-100);
    hIndex.current = history.current.length - 1;
    setNodes(snapshot.nodes);
    setLinks(snapshot.links);
    setSaveState("dirty");
  }, []);

  const undo = useCallback(() => {
    if (hIndex.current <= 0) return;
    hIndex.current -= 1;
    const s = history.current[hIndex.current];
    setNodes(s.nodes);
    setLinks(s.links);
    setSaveState("dirty");
  }, []);

  const redo = useCallback(() => {
    if (hIndex.current >= history.current.length - 1) return;
    hIndex.current += 1;
    const s = history.current[hIndex.current];
    setNodes(s.nodes);
    setLinks(s.links);
    setSaveState("dirty");
  }, []);

  /* ---------------- 自動保存(1.2秒デバウンス) ---------------- */

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const res = await saveMindmapSnapshotAction({ mindmapId: meta.id, nodes, links });
      if (res.ok) {
        setSaveState("saved");
        setErrorMsg(null);
      } else {
        setSaveState("error");
        setErrorMsg(res.error ?? "保存に失敗しました");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [nodes, links, meta.id]);

  /* ---------------- ノード操作 ---------------- */

  const patchNode = useCallback(
    (id: string, patch: Partial<MindmapNode>) => {
      commit(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    [nodes, commit],
  );

  /**
   * 文字入力用の即時反映(履歴を作らない)。
   * 1文字ごとに履歴が積まれるとUndoが使い物にならないため、確定(blur)時にまとめて履歴化する。
   */
  const patchNodeLive = useCallback((id: string, patch: Partial<MindmapNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setSaveState("dirty");
  }, []);

  /** 現在の状態を1つの履歴として確定する(テキスト入力から離れたとき)。 */
  const pushHistory = useCallback(() => {
    const last = history.current[hIndex.current];
    if (last.nodes === nodes && last.links === links) return;
    history.current = [...history.current.slice(0, hIndex.current + 1), { nodes, links }].slice(-100);
    hIndex.current = history.current.length - 1;
  }, [nodes, links]);

  const addChild = useCallback(
    (parentId: string) => {
      const siblings = childrenOf.get(parentId) ?? [];
      const node = blankNode(parentId, siblings.length);
      const next = nodes.map((n) => (n.id === parentId && n.collapsed ? { ...n, collapsed: false } : n));
      commit([...next, node]);
      setSelectedId(node.id);
      setEditingId(node.id);
      setDraft("");
    },
    [nodes, childrenOf, commit],
  );

  const addSibling = useCallback(
    (id: string) => {
      const target = nodeById.get(id);
      if (!target || !target.parent_id) return addChild(id); // ルートは子を足す
      const node = blankNode(target.parent_id, target.sort_order + 1);
      // 直後に差し込むため、後続の兄弟をひとつ後ろへずらす
      const renumbered = nodes.map((n) =>
        n.parent_id === target.parent_id && n.sort_order > target.sort_order ? { ...n, sort_order: n.sort_order + 1 } : n,
      );
      commit([...renumbered, node]);
      setSelectedId(node.id);
      setEditingId(node.id);
      setDraft("");
    },
    [nodes, nodeById, childrenOf, commit, addChild],
  );

  const removeNode = useCallback(
    (id: string) => {
      const target = nodeById.get(id);
      if (!target || !target.parent_id) return; // ルートは消せない
      const ids = subtreeIds(nodes, id);
      const nextNodes = nodes.filter((n) => !ids.has(n.id));
      const nextLinks = links.filter((l) => !ids.has(l.from_node_id) && !ids.has(l.to_node_id));
      commit(nextNodes, nextLinks);
      setSelectedId(target.parent_id);
      setEditingId(null);
    },
    [nodes, links, nodeById, commit],
  );

  /** 兄弟内の並び替え(-1=上へ / +1=下へ)。 */
  const reorder = useCallback(
    (id: string, dir: -1 | 1) => {
      const target = nodeById.get(id);
      if (!target || !target.parent_id) return;
      const siblings = childrenOf.get(target.parent_id) ?? [];
      const idx = siblings.findIndex((s) => s.id === id);
      const swapWith = siblings[idx + dir];
      if (!swapWith) return;
      commit(
        nodes.map((n) => {
          if (n.id === target.id) return { ...n, sort_order: swapWith.sort_order };
          if (n.id === swapWith.id) return { ...n, sort_order: target.sort_order };
          return n;
        }),
      );
    },
    [nodes, nodeById, childrenOf, commit],
  );

  /** ドラッグ&ドロップで親を付け替える。 */
  const reparent = useCallback(
    (id: string, newParentId: string) => {
      if (id === newParentId) return;
      const target = nodeById.get(id);
      if (!target || !target.parent_id) return; // ルートは動かせない
      const forbidden = subtreeIds(nodes, id);
      if (forbidden.has(newParentId)) return; // 自分の子孫には入れられない
      const siblings = childrenOf.get(newParentId) ?? [];
      commit(
        nodes.map((n) =>
          n.id === id
            ? { ...n, parent_id: newParentId, sort_order: siblings.length, color: null }
            : n.id === newParentId
              ? { ...n, collapsed: false }
              : n,
        ),
      );
      setSelectedId(id);
    },
    [nodes, nodeById, childrenOf, commit],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      const target = nodeById.get(id);
      if (!target || (childrenOf.get(id) ?? []).length === 0) return;
      patchNode(id, { collapsed: !target.collapsed });
    },
    [nodeById, childrenOf, patchNode],
  );

  /* ---------------- 編集(インライン) ---------------- */

  const startEdit = useCallback(
    (id: string) => {
      const n = nodeById.get(id);
      if (!n) return;
      setEditingId(id);
      setDraft(n.title);
    },
    [nodeById],
  );

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const current = nodeById.get(editingId);
    const title = draft.trim();
    setEditingId(null);
    if (!current) return;
    if (current.title === title) return;
    patchNode(editingId, { title });
  }, [editingId, draft, nodeById, patchNode]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  /* ---------------- 選択移動 ---------------- */

  const moveSelection = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      if (!selectedId) return;
      const cur = nodeById.get(selectedId);
      if (!cur) return;
      if (dir === "left") {
        if (cur.parent_id) setSelectedId(cur.parent_id);
        return;
      }
      if (dir === "right") {
        const kids = childrenOf.get(selectedId) ?? [];
        if (kids.length === 0) return;
        if (cur.collapsed) patchNode(selectedId, { collapsed: false });
        setSelectedId(kids[0].id);
        return;
      }
      if (!cur.parent_id) return;
      const siblings = childrenOf.get(cur.parent_id) ?? [];
      const idx = siblings.findIndex((s) => s.id === selectedId);
      const next = siblings[idx + (dir === "up" ? -1 : 1)];
      if (next) setSelectedId(next.id);
    },
    [selectedId, nodeById, childrenOf, patchNode],
  );

  /* ---------------- キーボード ---------------- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingId) return; // 編集中は入力欄側で処理
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!selectedId) return;

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          addChild(selectedId);
          break;
        case "Enter":
          e.preventDefault();
          addSibling(selectedId);
          break;
        case "F2":
          e.preventDefault();
          startEdit(selectedId);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeNode(selectedId);
          break;
        case " ":
          e.preventDefault();
          toggleCollapse(selectedId);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (mod) reorder(selectedId, -1);
          else moveSelection("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          if (mod) reorder(selectedId, 1);
          else moveSelection("down");
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveSelection("left");
          break;
        case "ArrowRight":
          e.preventDefault();
          moveSelection("right");
          break;
        case "Escape":
          setLinkFrom(null);
          break;
        default:
          break;
      }
    },
    [editingId, selectedId, addChild, addSibling, startEdit, removeNode, toggleCollapse, reorder, moveSelection, undo, redo],
  );

  /* ---------------- パン・ズーム ---------------- */

  const panState = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number; target: string | null } | null>(null);

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.tx) / view.scale - origin.x,
        y: (clientY - rect.top - view.ty) / view.scale - origin.y,
      };
    },
    [view, origin],
  );

  const hitTest = useCallback(
    (canvasX: number, canvasY: number, excludeIds: Set<string>): string | null => {
      for (const p of layout.nodes) {
        if (excludeIds.has(p.node.id)) continue;
        if (canvasX >= p.x && canvasX <= p.x + p.w && canvasY >= p.y && canvasY <= p.y + p.h) return p.node.id;
      }
      return null;
    },
    [layout],
  );

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panState.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panState.current) {
      const p = panState.current;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      applyView((v) => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }));
      return;
    }
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    const pt = toCanvas(e.clientX, e.clientY);
    const exclude = subtreeIds(nodes, d.id);
    setDragging({ id: d.id, x: e.clientX, y: e.clientY, target: hitTest(pt.x, pt.y, exclude) });
  };

  const onPointerUp = () => {
    panState.current = null;
    const d = dragState.current;
    dragState.current = null;
    if (d && d.moved && dragging?.target) reparent(d.id, dragging.target);
    setDragging(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dir = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyView((v) => {
        const scale = clampScale(v.scale * dir);
        const k = scale / v.scale;
        return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
      });
    } else {
      const { deltaX, deltaY } = e;
      applyView((v) => ({ ...v, tx: v.tx - deltaX, ty: v.ty - deltaY }));
    }
  };

  const zoomBy = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const px = rect ? rect.width / 2 : 0;
    const py = rect ? rect.height / 2 : 0;
    applyView((v) => {
      const scale = clampScale(v.scale * factor);
      const k = scale / v.scale;
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  };

  const fitToScreen = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || layout.width === 0) return;
    const scale = Math.min(
      1.2,
      Math.max(MIN_SCALE, Math.min(rect.width / (layout.width + PAD * 2), rect.height / (layout.height + PAD * 2))),
    );
    setView({
      scale,
      tx: (rect.width - (layout.width + PAD * 2) * scale) / 2,
      ty: (rect.height - (layout.height + PAD * 2) * scale) / 2,
    });
  }, [layout]);

  // 初回のみ全体表示に合わせる
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || layout.nodes.length === 0) return;
    fitted.current = true;
    fitToScreen();
  }, [layout, fitToScreen]);

  /* ---------------- Markdown / 関連線 / AI ---------------- */

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(tree));
      setErrorMsg("Markdownをコピーしました");
      setTimeout(() => setErrorMsg(null), 2000);
    } catch {
      setErrorMsg("クリップボードにコピーできませんでした");
    }
  };

  const pasteMarkdown = async () => {
    if (!selectedId) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setErrorMsg("クリップボードを読み取れませんでした（ブラウザの許可が必要です）");
      return;
    }
    const parsed = parseMarkdown(text);
    if (parsed.length === 0) return;
    const added: MindmapNode[] = [];
    const base = (childrenOf.get(selectedId) ?? []).length;
    const walk = (list: ParsedNode[], parentId: string, offset: number) => {
      list.forEach((item, i) => {
        const node = blankNode(parentId, offset + i);
        node.title = item.title;
        added.push(node);
        if (item.children.length > 0) walk(item.children, node.id, 0);
      });
    };
    walk(parsed, selectedId, base);
    commit([...nodes.map((n) => (n.id === selectedId ? { ...n, collapsed: false } : n)), ...added]);
  };

  const startLink = () => {
    if (!selectedId) return;
    if (linkFrom && linkFrom !== selectedId) {
      const link: MindmapLink = { id: uid(), from_node_id: linkFrom, to_node_id: selectedId, label: null };
      commit(nodes, [...links, link]);
      setLinkFrom(null);
    } else {
      setLinkFrom(selectedId);
    }
  };

  const askAi = async () => {
    if (!selectedId) return;
    setAiBusy(true);
    setErrorMsg(null);
    // ルートからのパスを渡すと文脈が効く
    const path: string[] = [];
    let cur: MindmapNode | undefined = nodeById.get(selectedId);
    while (cur) {
      path.unshift(cur.title || "（無題）");
      cur = cur.parent_id ? nodeById.get(cur.parent_id) : undefined;
    }
    const res = await suggestChildNodesAction({ mindmapId: meta.id, path });
    setAiBusy(false);
    if (!res.ok || !res.titles) {
      setErrorMsg(res.error ?? "AI提案に失敗しました");
      return;
    }
    const base = (childrenOf.get(selectedId) ?? []).length;
    const added = res.titles.map((t, i) => {
      const n = blankNode(selectedId, base + i);
      n.title = t;
      return n;
    });
    commit([...nodes.map((n) => (n.id === selectedId ? { ...n, collapsed: false } : n)), ...added]);
  };

  /** 全体をたたむ/開く。大きなマップを一望したいときの逃げ道。 */
  const setAllCollapsed = useCallback(
    (collapsed: boolean) => {
      commit(nodes.map((n) => (n.parent_id ? { ...n, collapsed } : n)));
    },
    [nodes, commit],
  );

  const changeLayout = async (mode: MindmapLayout) => {
    setLayoutMode(mode);
    await updateMindmapMetaAction({ mindmapId: meta.id, layout: mode });
  };

  /* ---------------- 描画 ---------------- */

  const saveLabel =
    saveState === "saving" ? "保存中…" : saveState === "dirty" ? "未保存" : saveState === "error" ? "保存エラー" : "保存済み";

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] min-h-[520px]">
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        <ToolBtn onClick={() => selectedId && addChild(selectedId)} disabled={!selectedId} icon={<Plus size={15} />} label="子ノード" hint="Tab" />
        <ToolBtn onClick={() => selectedId && addSibling(selectedId)} disabled={!selectedId} icon={<CornerDownRight size={15} />} label="兄弟ノード" hint="Enter" />
        <ToolBtn onClick={() => selectedId && removeNode(selectedId)} disabled={!selected?.parent_id} icon={<Trash2 size={15} />} label="削除" hint="Delete" />
        <span className="w-px h-5 bg-black/10 mx-1" />
        <ToolBtn onClick={undo} icon={<Undo2 size={15} />} label="元に戻す" hint="Ctrl+Z" />
        <ToolBtn onClick={redo} icon={<Redo2 size={15} />} label="やり直し" hint="Ctrl+Shift+Z" />
        <span className="w-px h-5 bg-black/10 mx-1" />
        <ToolBtn onClick={() => zoomBy(1 / 1.15)} icon={<ZoomOut size={15} />} label="縮小" />
        <ToolBtn onClick={() => zoomBy(1.15)} icon={<ZoomIn size={15} />} label="拡大" />
        <ToolBtn onClick={fitToScreen} icon={<Maximize2 size={15} />} label="全体表示" />
        <ToolBtn onClick={() => setAllCollapsed(true)} icon={<ChevronRight size={15} />} label="全部たたむ" />
        <ToolBtn onClick={() => setAllCollapsed(false)} icon={<ChevronDown size={15} />} label="全部開く" />
        <select
          className="input !w-auto !py-1 !px-2 text-xs"
          value={layoutMode}
          onChange={(e) => void changeLayout(e.target.value as MindmapLayout)}
          aria-label="レイアウト"
        >
          <option value="right">右方向</option>
          <option value="both">左右に展開</option>
        </select>
        <span className="w-px h-5 bg-black/10 mx-1" />
        <ToolBtn onClick={startLink} disabled={!selectedId} icon={<Link2 size={15} />} label={linkFrom ? "接続先を選ぶ" : "関連線"} active={!!linkFrom} />
        <ToolBtn onClick={askAi} disabled={!selectedId || aiBusy} icon={<Sparkles size={15} />} label={aiBusy ? "生成中…" : "AIで枝を広げる"} />
        <ToolBtn onClick={copyMarkdown} icon={<Copy size={15} />} label="Markdownコピー" />
        <ToolBtn onClick={pasteMarkdown} disabled={!selectedId} icon={<ClipboardPaste size={15} />} label="Markdown貼付" />

        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "text-xs font-semibold",
              saveState === "error" ? "text-red-600" : saveState === "saved" ? "text-ink/40" : "text-accent-orange",
            )}
          >
            {saveLabel}
          </span>
          <Link href={`/app/mindmaps/${meta.id}/present`} className="btn-accent !py-1.5 !px-3 text-xs">
            <Play size={14} /> プレゼン
          </Link>
          <button type="button" className="btn-ghost !py-1.5 !px-2" onClick={() => setShowInspector((s) => !s)} aria-label="詳細パネル">
            {showInspector ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </div>

      {errorMsg && <div className="mb-2 text-xs font-semibold text-accent-orange">{errorMsg}</div>}

      <div className="flex-1 flex gap-3 min-h-0">
        {/* キャンバス */}
        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative flex-1 min-w-0 card overflow-hidden outline-none cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: "none" }}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
          >
            {/* エッジ。SVGはマップ全体ではなく「可視範囲ぶん」だけの大きさにする
                (マップ全体サイズの要素に scale が掛かるとラスタライズでメモリが破綻するため) */}
            <svg
              className="absolute pointer-events-none"
              style={{
                left: viewBox.x0 + origin.x,
                top: viewBox.y0 + origin.y,
                width: Math.max(1, viewBox.x1 - viewBox.x0),
                height: Math.max(1, viewBox.y1 - viewBox.y0),
              }}
            >
              <g transform={`translate(${-(viewBox.x0 + origin.x)}, ${-(viewBox.y0 + origin.y)})`}>
              {visibleEdges.map((e) => {
                const x1 = e.x1 + origin.x;
                const y1 = e.y1 + origin.y;
                const x2 = e.x2 + origin.x;
                const y2 = e.y2 + origin.y;
                const mid = (x1 + x2) / 2;
                return (
                  <path
                    key={`${e.fromId}-${e.toId}`}
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={e.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                );
              })}
              {/* 関連線(枝をまたぐ破線矢印) */}
              <defs>
                <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#0D2828" />
                </marker>
              </defs>
              {links.map((l) => {
                const a = layout.byId.get(l.from_node_id);
                const b = layout.byId.get(l.to_node_id);
                if (!a || !b) return null;
                const x1 = a.x + a.w + origin.x;
                const y1 = a.cy + origin.y;
                const x2 = b.x + origin.x;
                const y2 = b.cy + origin.y;
                const cx = (x1 + x2) / 2 + 60;
                return (
                  <path
                    key={l.id}
                    d={`M ${x1} ${y1} Q ${cx} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#0D2828"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    markerEnd="url(#mm-arrow)"
                    opacity={0.6}
                  />
                );
              })}
              </g>
            </svg>

            {/* ノード(可視範囲のみ) */}
            {visibleNodes.map((p) => {
              const n = p.node;
              const isSelected = n.id === selectedId;
              const isDropTarget = dragging?.target === n.id;
              const isLinkSource = linkFrom === n.id;
              const badge = markerBadge(n.marker);
              const kids = childrenOf.get(n.id) ?? [];
              const isRoot = !n.parent_id;
              const color = n.color ?? p.color;

              return (
                <div
                  key={n.id}
                  className={cn(
                    "absolute rounded-xl border-2 bg-white shadow-sm transition-shadow",
                    isSelected && "ring-2 ring-offset-1 ring-teal-primary",
                    isDropTarget && "ring-2 ring-accent-orange",
                    isLinkSource && "ring-2 ring-purple-500",
                    dragging?.id === n.id && "opacity-40",
                  )}
                  style={{
                    left: p.x + origin.x,
                    top: p.y + origin.y,
                    width: p.w,
                    minHeight: p.h,
                    borderColor: color,
                    backgroundColor: isRoot ? color : `${color}14`,
                    color: isRoot ? "#fff" : "#0D2828",
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (e.button !== 0) return;
                    setSelectedId(n.id);
                    if (!isRoot) dragState.current = { id: n.id, startX: e.clientX, startY: e.clientY, moved: false };
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEdit(n.id);
                  }}
                >
                  <div className="flex items-start gap-1.5 px-3 py-2">
                    {badge && (
                      <span
                        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: badge.bg }}
                      >
                        {badge.text}
                      </span>
                    )}
                    {editingId === n.id ? (
                      <textarea
                        ref={editInputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitEdit}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            commitEdit();
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingId(null);
                          }
                        }}
                        rows={1}
                        className="w-full resize-none bg-white/90 text-ink text-[13.5px] leading-5 rounded px-1 outline-none border border-teal-primary"
                      />
                    ) : (
                      <span
                        className={cn(
                          "text-[13.5px] leading-5 font-medium break-words whitespace-pre-wrap",
                          n.status === "done" && "line-through opacity-60",
                        )}
                      >
                        {n.title || "（無題）"}
                      </span>
                    )}
                    {n.due_date && !isRoot && (
                      <span className="ml-auto shrink-0 text-[10px] font-semibold text-ink/50 mt-0.5">{n.due_date.slice(5)}</span>
                    )}
                  </div>

                  {/* 折り畳みトグル(子孫件数つき) */}
                  {kids.length > 0 && !isRoot && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(n.id);
                      }}
                      className="absolute -right-3 top-1/2 -translate-y-1/2 inline-flex h-5 min-w-5 items-center justify-center rounded-full border bg-white px-1 text-[10px] font-bold shadow-sm"
                      style={{ borderColor: color, color }}
                      title={n.collapsed ? "展開" : "折り畳み"}
                    >
                      {n.collapsed ? p.hiddenChildren : <ChevronRight size={11} />}
                    </button>
                  )}
                  {n.ref_url && (
                    <Link
                      href={n.ref_url}
                      target={n.ref_url.startsWith("http") ? "_blank" : undefined}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute -top-2 -left-2 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-white text-teal-primary shadow-sm"
                      title="元データを開く"
                    >
                      <ExternalLink size={11} />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          <div className="absolute bottom-2 left-3 text-[11px] text-ink/40 pointer-events-none">
            Tab=子 / Enter=兄弟 / F2=編集 / Delete=削除 / Space=折り畳み / ドラッグで付け替え / Ctrl+ホイール=ズーム
          </div>
          <div className="absolute bottom-2 right-3 text-[11px] tabular-nums text-ink/30 pointer-events-none">
            {nodes.length}ノード（表示 {visibleNodes.length}）/ {Math.round(view.scale * 100)}%
          </div>
        </div>

        {/* インスペクタ */}
        {showInspector && (
          <div className="w-72 shrink-0 card card-pad overflow-y-auto">
            {selected ? (
              <Inspector
                node={selected}
                childCount={(childrenOf.get(selected.id) ?? []).length}
                onPatch={(patch) => patchNode(selected.id, patch)}
                onPatchLive={(patch) => patchNodeLive(selected.id, patch)}
                onCommitText={pushHistory}
                onAddChild={() => addChild(selected.id)}
                onDelete={() => removeNode(selected.id)}
                onEdit={() => startEdit(selected.id)}
              />
            ) : (
              <p className="text-sm text-ink/40">ノードを選ぶと詳細を編集できます。</p>
            )}
          </div>
        )}
      </div>

      {/* ドラッグ中のゴースト */}
      {dragging && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg bg-teal-primary px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          style={{ left: dragging.x + 12, top: dragging.y + 12 }}
        >
          {nodeById.get(dragging.id)?.title || "（無題）"}
          {dragging.target && <span className="ml-1 opacity-80">→ {nodeById.get(dragging.target)?.title}</span>}
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  onClick,
  icon,
  label,
  hint,
  disabled,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label}（${hint}）` : label}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs font-semibold text-ink/80 hover:bg-mist-soft disabled:opacity-40",
        active && "border-teal-primary text-teal-primary bg-teal-light",
      )}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function Inspector({
  node,
  childCount,
  onPatch,
  onPatchLive,
  onCommitText,
  onAddChild,
  onDelete,
  onEdit,
}: {
  node: MindmapNode;
  childCount: number;
  onPatch: (patch: Partial<MindmapNode>) => void;
  /** 1文字ごとの反映(履歴なし) */
  onPatchLive: (patch: Partial<MindmapNode>) => void;
  /** 入力確定時に履歴へ積む */
  onCommitText: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">タイトル</label>
        <textarea
          className="input min-h-[60px]"
          value={node.title}
          onChange={(e) => onPatchLive({ title: e.target.value })}
          onBlur={onCommitText}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div>
        <label className="label">メモ</label>
        <textarea
          className="input min-h-[70px] text-xs"
          value={node.note ?? ""}
          placeholder="補足・背景・決めたこと"
          onChange={(e) => onPatchLive({ note: e.target.value || null })}
          onBlur={onCommitText}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">期日</label>
          <input
            type="date"
            className="input !py-1.5 text-xs"
            value={node.due_date ?? ""}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div>
          <label className="label">状態</label>
          <select
            className="input !py-1.5 text-xs"
            value={node.status}
            onChange={(e) => onPatch({ status: e.target.value as NodeStatus })}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">マーカー</label>
        <select
          className="input !py-1.5 text-xs"
          value={node.marker}
          onChange={(e) => onPatch({ marker: e.target.value as NodeMarker })}
        >
          {Object.entries(MARKER_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">色</label>
        <div className="flex flex-wrap gap-1.5">
          {BRANCH_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPatch({ color: c })}
              className={cn("h-6 w-6 rounded-full border-2", node.color === c ? "border-ink" : "border-white")}
              style={{ backgroundColor: c }}
              aria-label={`色 ${c}`}
            />
          ))}
          <button type="button" onClick={() => onPatch({ color: null })} className="h-6 rounded-full border border-black/10 px-2 text-[10px] font-semibold">
            継承
          </button>
        </div>
      </div>
      {node.ref_url && (
        <Link href={node.ref_url} target={node.ref_url.startsWith("http") ? "_blank" : undefined} className="btn-ghost w-full !py-1.5 text-xs">
          <ExternalLink size={13} /> 元データを開く
        </Link>
      )}
      <div className="flex items-center gap-1.5 pt-1">
        <button type="button" onClick={onAddChild} className="btn-primary !py-1.5 !px-3 text-xs">
          <Plus size={13} /> 子
        </button>
        <button type="button" onClick={onEdit} className="btn-ghost !py-1.5 !px-3 text-xs">
          直接編集
        </button>
        <button type="button" onClick={onDelete} disabled={!node.parent_id} className="btn-ghost !py-1.5 !px-3 text-xs text-red-600">
          <Trash2 size={13} />
        </button>
      </div>
      <p className="text-[11px] text-ink/40 flex items-center gap-1">
        <ChevronDown size={11} /> 子ノード {childCount}件
      </p>
    </div>
  );
}
