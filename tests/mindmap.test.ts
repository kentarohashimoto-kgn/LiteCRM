/**
 * マインドマップの回帰テスト。
 *  - レイアウト(親が子群の中心 / 兄弟が重ならない / 折り畳み)
 *  - Markdown 入出力
 *  - 保存前検証(循環・孤児・ルート数)
 *  - 週次自動生成(日別グルーピング・漏れ検出)
 */
import { describe, expect, it } from "vitest";
import {
  buildTree,
  countDescendants,
  edgeInBox,
  layoutMindmap,
  nodeInBox,
  parseMarkdown,
  subtreeIds,
  toMarkdown,
  validateNodes,
  visibleBox,
  type MindmapNode,
} from "@/lib/mindmap";
import {
  COLLAPSE_OVER,
  LIMITS,
  addDays,
  autoCollapse,
  buildWeeklyMindmap,
  dayLabel,
  detectOverlaps,
  detectSequences,
  prepForStage,
  weekDays,
  type NodeSpec,
  type WeeklyDeal,
  type WeeklyEvent,
  type WeeklySource,
  type WeeklyTask,
} from "@/lib/mindmap-weekly";

function node(id: string, parent: string | null, title: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id,
    parent_id: parent,
    title,
    note: null,
    sort_order: 0,
    collapsed: false,
    color: null,
    marker: "none",
    status: "none",
    due_date: null,
    ref_type: "none",
    ref_id: null,
    ref_url: null,
    ...extra,
  };
}

/** ルート + 子3つ + 孫2つ */
function sampleNodes(): MindmapNode[] {
  return [
    node("root", null, "ルート"),
    node("a", "root", "枝A", { sort_order: 0 }),
    node("b", "root", "枝B", { sort_order: 1 }),
    node("c", "root", "枝C", { sort_order: 2 }),
    node("a1", "a", "A-1", { sort_order: 0 }),
    node("a2", "a", "A-2", { sort_order: 1 }),
  ];
}

describe("buildTree", () => {
  it("親子関係と並び順どおりにツリーを組む", () => {
    const tree = buildTree(sampleNodes());
    expect(tree?.id).toBe("root");
    expect(tree?.children.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(tree?.children[0].children.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(tree?.children[0].depth).toBe(1);
    expect(tree?.children[0].children[0].depth).toBe(2);
  });

  it("親が見つからない孤児はルート直下に救済する", () => {
    const nodes = [...sampleNodes(), node("orphan", "missing-parent", "迷子")];
    const tree = buildTree(nodes);
    expect(tree?.children.some((c) => c.id === "orphan")).toBe(true);
  });

  it("子孫数を数えられる", () => {
    const tree = buildTree(sampleNodes());
    expect(countDescendants(tree!)).toBe(5);
    expect(countDescendants(tree!.children[0])).toBe(2);
  });
});

describe("subtreeIds", () => {
  it("自分と子孫を集める", () => {
    const ids = subtreeIds(sampleNodes(), "a");
    expect([...ids].sort()).toEqual(["a", "a1", "a2"]);
  });
});

describe("layoutMindmap", () => {
  it("親は子群の縦中心に置かれる", () => {
    const layout = layoutMindmap(buildTree(sampleNodes()));
    const a = layout.byId.get("a")!;
    const a1 = layout.byId.get("a1")!;
    const a2 = layout.byId.get("a2")!;
    expect(a.cy).toBeCloseTo((a1.cy + a2.cy) / 2, 5);
  });

  it("兄弟ノードは縦に重ならない", () => {
    const layout = layoutMindmap(buildTree(sampleNodes()));
    const [a, b, c] = ["a", "b", "c"].map((id) => layout.byId.get(id)!);
    expect(a.y + a.h).toBeLessThanOrEqual(b.y);
    expect(b.y + b.h).toBeLessThanOrEqual(c.y);
  });

  it("子は親より右に配置される", () => {
    const layout = layoutMindmap(buildTree(sampleNodes()));
    const a = layout.byId.get("a")!;
    const a1 = layout.byId.get("a1")!;
    expect(a1.x).toBeGreaterThan(a.x + a.w);
  });

  it("折り畳んだノードの子は配置されない", () => {
    const nodes = sampleNodes().map((n) => (n.id === "a" ? { ...n, collapsed: true } : n));
    const layout = layoutMindmap(buildTree(nodes));
    expect(layout.byId.has("a1")).toBe(false);
    expect(layout.byId.get("a")!.hiddenChildren).toBe(2);
  });

  it("both レイアウトでは一部の枝が左側(負のX)に出る", () => {
    const layout = layoutMindmap(buildTree(sampleNodes()), { layout: "both" });
    expect(layout.nodes.some((p) => p.dir === -1)).toBe(true);
    expect(layout.minX).toBeLessThan(0);
  });

  it("深さが不揃いなツリーでも、いとこ同士の枝が重ならない", () => {
    // 枝Aは孫まで、枝Bは葉、枝Cは孫が多い、という非対称なツリー
    const nodes: MindmapNode[] = [node("root", null, "ルート")];
    const shape: [string, number, number][] = [
      ["a", 3, 2], // 子3つ・各子に孫2つ
      ["b", 0, 0],
      ["c", 5, 1],
      ["d", 1, 4],
    ];
    shape.forEach(([id, kids, grandKids], bi) => {
      nodes.push(node(id, "root", `枝${id.toUpperCase()}`, { sort_order: bi }));
      for (let i = 0; i < kids; i++) {
        nodes.push(node(`${id}${i}`, id, `${id}-${i}`, { sort_order: i }));
        for (let g = 0; g < grandKids; g++) {
          nodes.push(node(`${id}${i}g${g}`, `${id}${i}`, `${id}-${i}-孫${g}`, { sort_order: g }));
        }
      }
    });

    const layout = layoutMindmap(buildTree(nodes));
    expect(layout.nodes).toHaveLength(nodes.length);

    // X範囲が重なるノード同士は、Y範囲が重なってはいけない
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const p = layout.nodes[i];
        const q = layout.nodes[j];
        const xOverlap = p.x < q.x + q.w && q.x < p.x + p.w;
        if (!xOverlap) continue;
        const yOverlap = p.y < q.y + q.h && q.y < p.y + p.h;
        expect(yOverlap, `${p.node.title} と ${q.node.title} が重なっています`).toBe(false);
      }
    }
  });

  it("第1階層ごとに色が変わり、子は親の色を継承する", () => {
    const layout = layoutMindmap(buildTree(sampleNodes()));
    const a = layout.byId.get("a")!;
    const b = layout.byId.get("b")!;
    const a1 = layout.byId.get("a1")!;
    expect(a.color).not.toBe(b.color);
    expect(a1.color).toBe(a.color);
  });
});

describe("可視範囲カリング(落ちる原因だった描画量の抑制)", () => {
  const origin = { x: 0, y: 0 };
  const view = { tx: 0, ty: 0, scale: 1 };

  it("画面内のノードは描画対象、遠く離れたノードは除外される", () => {
    const box = visibleBox(view, 1000, 600, origin, 0);
    expect(nodeInBox(box, { x: 10, y: 10, w: 100, h: 40 })).toBe(true);
    expect(nodeInBox(box, { x: 10, y: 20000, w: 100, h: 40 })).toBe(false);
    expect(nodeInBox(box, { x: -5000, y: 10, w: 100, h: 40 })).toBe(false);
  });

  it("境界にまたがるノードは描画対象に含める(端が切れない)", () => {
    const box = visibleBox(view, 1000, 600, origin, 0);
    expect(nodeInBox(box, { x: 960, y: 10, w: 100, h: 40 })).toBe(true); // 右端をまたぐ
    expect(nodeInBox(box, { x: -50, y: 10, w: 100, h: 40 })).toBe(true); // 左端をまたぐ
  });

  it("余白ぶんは先読みして描画する(スクロール時のちらつき防止)", () => {
    const box = visibleBox(view, 1000, 600, origin, 400);
    expect(nodeInBox(box, { x: 10, y: 800, w: 100, h: 40 })).toBe(true); // 画面外だが余白内
    expect(nodeInBox(box, { x: 10, y: 1600, w: 100, h: 40 })).toBe(false); // 余白の外
  });

  it("縮小すると可視範囲が広がり、拡大すると狭まる", () => {
    const wide = visibleBox({ tx: 0, ty: 0, scale: 0.25 }, 1000, 600, origin, 0);
    const tight = visibleBox({ tx: 0, ty: 0, scale: 2 }, 1000, 600, origin, 0);
    expect(wide.y1).toBeGreaterThan(tight.y1);
    expect(nodeInBox(wide, { x: 10, y: 2000, w: 100, h: 40 })).toBe(true);
    expect(nodeInBox(tight, { x: 10, y: 2000, w: 100, h: 40 })).toBe(false);
  });

  it("パンした先のノードが描画対象になる", () => {
    const panned = visibleBox({ tx: 0, ty: -5000, scale: 1 }, 1000, 600, origin, 0);
    expect(nodeInBox(panned, { x: 10, y: 5100, w: 100, h: 40 })).toBe(true);
    expect(nodeInBox(panned, { x: 10, y: 10, w: 100, h: 40 })).toBe(false);
  });

  it("エッジも外接矩形で判定される", () => {
    const box = visibleBox(view, 1000, 600, origin, 0);
    expect(edgeInBox(box, { x1: 10, y1: 10, x2: 200, y2: 300 })).toBe(true);
    expect(edgeInBox(box, { x1: 10, y1: 9000, x2: 200, y2: 9300 })).toBe(false);
    expect(edgeInBox(box, { x1: 10, y1: 300, x2: 200, y2: 9000 })).toBe(true); // 画面内から外へ伸びる線
  });

  it("巨大マップでも描画されるのは一部だけ", () => {
    // 縦2万px相当に散らばった500ノードを想定
    const nodes = Array.from({ length: 500 }, (_, i) => ({ x: 0, y: i * 40, w: 200, h: 36 }));
    const box = visibleBox(view, 1200, 700, origin, 400);
    const drawn = nodes.filter((n) => nodeInBox(box, n)).length;
    expect(drawn).toBeLessThan(50);
    expect(drawn).toBeGreaterThan(0);
  });
});

describe("Markdown 入出力", () => {
  it("出力→入力でツリー構造が保たれる", () => {
    const md = toMarkdown(buildTree(sampleNodes()));
    const parsed = parseMarkdown(md.split("\n").slice(1).join("\n")); // 見出し行(ルート)を除く
    expect(parsed.map((p) => p.title)).toEqual(["枝A", "枝B", "枝C"]);
    expect(parsed[0].children.map((c) => c.title)).toEqual(["A-1", "A-2"]);
  });

  it("タブ・番号付き・記号なしの行も取り込める", () => {
    const parsed = parseMarkdown(["1. 章1", "\t- 節1", "  * 節2", "章2"].join("\n"));
    expect(parsed[0].title).toBe("章1");
    expect(parsed[0].children.map((c) => c.title)).toEqual(["節1", "節2"]);
    expect(parsed[1].title).toBe("章2");
  });
});

describe("validateNodes", () => {
  it("正常なツリーは通る", () => {
    expect(validateNodes(sampleNodes())).toEqual({ ok: true });
  });

  it("ルートが2つあると弾く", () => {
    const nodes = [...sampleNodes(), node("root2", null, "もう1つのルート")];
    expect(validateNodes(nodes).ok).toBe(false);
  });

  it("親が存在しないノードを弾く", () => {
    const nodes = [...sampleNodes(), node("x", "nope", "迷子")];
    const res = validateNodes(nodes);
    expect(res.ok).toBe(false);
  });

  it("循環を弾く", () => {
    const nodes = [node("root", null, "ルート"), node("p", "q", "P"), node("q", "p", "Q")];
    const res = validateNodes(nodes);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("循環");
  });

  it("IDの重複を弾く", () => {
    const nodes = [...sampleNodes(), node("a", "root", "重複ID")];
    expect(validateNodes(nodes).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 週次自動生成                                                        */
/* ------------------------------------------------------------------ */

const WEEK = "2026-07-27"; // 月曜

function ev(partial: Partial<WeeklyEvent> & { id: string; date: string; title: string }): WeeklyEvent {
  return {
    startAt: null,
    endAt: null,
    source: "crm",
    accountName: null,
    opportunityId: null,
    opportunityName: null,
    stage: null,
    yomi: null,
    url: null,
    ...partial,
  };
}

function source(over: Partial<WeeklySource> = {}): WeeklySource {
  return {
    weekStart: WEEK,
    events: [],
    deals: [],
    tasks: [],
    repPlan: null,
    calendarConnected: true,
    ...over,
  };
}

function findChild(spec: NodeSpec, predicate: (t: string) => boolean): NodeSpec | undefined {
  for (const c of spec.children ?? []) {
    if (predicate(c.title)) return c;
    const deep = findChild(c, predicate);
    if (deep) return deep;
  }
  return undefined;
}

describe("週の日付ユーティリティ", () => {
  it("月曜から7日分を返す", () => {
    const days = weekDays(WEEK);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-07-27");
    expect(days[6]).toBe("2026-08-02");
  });

  it("月をまたぐ加算ができる", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("曜日ラベルを作る", () => {
    expect(dayLabel("2026-07-27", 0)).toBe("7/27(月)");
    expect(dayLabel("2026-08-02", 6)).toBe("8/2(日)");
  });
});

describe("段取り検出", () => {
  it("ステージ別に定型準備が変わる", () => {
    expect(prepForStage("proposal_sent", null).join()).toContain("提案書");
    expect(prepForStage("verbal_commit", null).join()).toContain("契約書");
    expect(prepForStage(null, "4.アポ").join()).toContain("事前調査");
    expect(prepForStage("won", null)).toEqual([]);
  });

  it("同日の時間帯が重なる予定を検出する", () => {
    const events = [
      ev({ id: "1", date: WEEK, title: "A社", startAt: "2026-07-27T01:00:00Z", endAt: "2026-07-27T02:00:00Z" }),
      ev({ id: "2", date: WEEK, title: "B社", startAt: "2026-07-27T01:30:00Z", endAt: "2026-07-27T02:30:00Z" }),
      ev({ id: "3", date: WEEK, title: "C社", startAt: "2026-07-27T05:00:00Z", endAt: "2026-07-27T06:00:00Z" }),
    ];
    const overlaps = detectOverlaps(events);
    expect(overlaps).toHaveLength(1);
    expect([overlaps[0].a.title, overlaps[0].b.title]).toEqual(["A社", "B社"]);
  });

  it("同一顧客で週内に複数の予定があると前後関係の候補になる", () => {
    const events = [
      ev({ id: "1", date: WEEK, title: "打合せ", accountName: "松岡建設" }),
      ev({ id: "2", date: addDays(WEEK, 2), title: "提案", accountName: "松岡建設" }),
      ev({ id: "3", date: WEEK, title: "単発", accountName: "和光紙器" }),
    ];
    const seqs = detectSequences(events);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].account).toBe("松岡建設");
    expect(seqs[0].events[0].date).toBe(WEEK);
  });
});

describe("buildWeeklyMindmap", () => {
  it("ルートと7日分＋事前準備＋今月/来月クロージングの枝を作る", () => {
    const spec = buildWeeklyMindmap(source());
    expect(spec.title).toBe("7/27週の予定");
    const titles = (spec.children ?? []).map((c) => c.title);
    expect(titles[0]).toBe("事前準備（今週の仕込み）");
    for (const label of ["7/27(月)", "7/28(火)", "8/2(日)"]) expect(titles).toContain(label);
    expect(titles.some((t) => t.startsWith("今月クロージング"))).toBe(true);
    expect(titles.some((t) => t.startsWith("来月クロージング"))).toBe(true);
  });

  it("予定は日付の枝にぶら下がり、時刻順に並ぶ", () => {
    const spec = buildWeeklyMindmap(
      source({
        events: [
          ev({ id: "2", date: WEEK, title: "午後訪問", startAt: "2026-07-27T06:00:00Z", accountName: "B社" }),
          ev({ id: "1", date: WEEK, title: "午前MTG", startAt: "2026-07-27T01:00:00Z", accountName: "A社" }),
        ],
      }),
    );
    const monday = (spec.children ?? []).find((c) => c.title === "7/27(月)");
    expect(monday?.children?.map((c) => c.title.includes("A社"))).toEqual([true, false]);
  });

  it("今月クロージング予定なのに週内の接点が無いと警告枝を出す", () => {
    const spec = buildWeeklyMindmap(
      source({
        deals: [
          {
            id: "d1",
            name: "AI研修",
            accountName: "松岡建設",
            amount: 5_000_000,
            probability: 70,
            yomi: "2.B",
            stage: "proposal_sent",
            expectedCloseDate: "2026-07-31",
            nextAction: "見積提出",
            ownerName: "橋本",
          },
        ],
      }),
    );
    const branch = findChild(spec, (t) => t.startsWith("今週接点なし"));
    expect(branch).toBeTruthy();
    expect(findChild(branch!, (t) => t.includes("松岡建設"))).toBeTruthy();
  });

  it("週内に接点があれば接点なし警告は出ない", () => {
    const spec = buildWeeklyMindmap(
      source({
        events: [ev({ id: "1", date: WEEK, title: "提案", accountName: "松岡建設", opportunityId: "d1" })],
        deals: [
          {
            id: "d1",
            name: "AI研修",
            accountName: "松岡建設",
            amount: 5_000_000,
            probability: 70,
            yomi: "2.B",
            stage: "proposal_sent",
            expectedCloseDate: "2026-07-31",
            nextAction: "見積提出",
            ownerName: null,
          },
        ],
      }),
    );
    expect(findChild(spec, (t) => t.startsWith("今週接点なし"))).toBeUndefined();
  });

  it("次アクション未設定の案件を警告する", () => {
    const spec = buildWeeklyMindmap(
      source({
        events: [ev({ id: "1", date: WEEK, title: "訪問", accountName: "和光紙器", opportunityId: "d2" })],
        deals: [
          {
            id: "d2",
            name: "紙器DX",
            accountName: "和光紙器",
            amount: 1_000_000,
            probability: 40,
            yomi: "3.C",
            stage: "needs_confirmed",
            expectedCloseDate: "2026-07-20",
            nextAction: null,
            ownerName: null,
          },
        ],
      }),
    );
    expect(findChild(spec, (t) => t.startsWith("次アクション未設定"))).toBeTruthy();
  });

  it("期日超過タスクを遅延として拾う", () => {
    const spec = buildWeeklyMindmap(
      source({
        tasks: [
          { id: "t1", title: "議事録送付", dueDate: "2026-07-20", status: "todo", accountName: null, opportunityId: null },
          { id: "t2", title: "今週の資料", dueDate: WEEK, status: "todo", accountName: null, opportunityId: null },
        ],
      }),
    );
    expect(findChild(spec, (t) => t.startsWith("期日超過タスク"))).toBeTruthy();
    expect(findChild(spec, (t) => t.includes("(遅延 2026-07-20)"))).toBeTruthy();
    // 今週期日のタスクは当日の枝に入る
    const monday = (spec.children ?? []).find((c) => c.title === "7/27(月)");
    expect(monday?.children?.some((c) => c.title === "タスク: 今週の資料")).toBe(true);
  });

  it("カレンダー未連携なら注意枝を足す", () => {
    const spec = buildWeeklyMindmap(source({ calendarConnected: false }));
    expect(findChild(spec, (t) => t.includes("Googleカレンダー未連携"))).toBeTruthy();
  });

  it("生成結果はそのまま保存検証を通せる構造になっている", () => {
    const spec = buildWeeklyMindmap(source());
    // NodeSpec を id 付きに落として検証(server action の flattenSpec と同じ形)
    const rows: { id: string; parent_id: string | null }[] = [];
    let seq = 0;
    const walk = (s: NodeSpec, parent: string | null) => {
      const id = `n${seq++}`;
      rows.push({ id, parent_id: parent });
      for (const c of s.children ?? []) walk(c, id);
    };
    walk(spec, null);
    expect(validateNodes(rows)).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* 巨大化の防止(本番で416ノード・縦2万pxになりブラウザが落ちた回帰)      */
/* ------------------------------------------------------------------ */

function countSpec(spec: NodeSpec): number {
  return 1 + (spec.children ?? []).reduce((s, c) => s + countSpec(c), 0);
}

/** 折り畳みを考慮した「最初に描画されるノード数」。 */
function countVisible(spec: NodeSpec): number {
  if (spec.collapsed) return 1;
  return 1 + (spec.children ?? []).reduce((s, c) => s + countVisible(c), 0);
}

function maxChildren(spec: NodeSpec): number {
  const kids = spec.children ?? [];
  return Math.max(kids.length, ...kids.map(maxChildren), 0);
}

/** 本番と同じ形の高負荷データ: 7/31に122件のタスク、期日超過168件、案件多数。 */
function heavySource(): WeeklySource {
  const tasks: WeeklyTask[] = [];
  for (let i = 0; i < 122; i++) {
    tasks.push({ id: `t31-${i}`, title: `月末タスク${i}`, dueDate: "2026-07-31", status: "todo", accountName: null, opportunityId: null });
  }
  for (let i = 0; i < 168; i++) {
    tasks.push({ id: `tod-${i}`, title: `遅延タスク${i}`, dueDate: "2026-07-10", status: "todo", accountName: null, opportunityId: null });
  }
  const deals: WeeklyDeal[] = [];
  for (let i = 0; i < 40; i++) {
    deals.push({
      id: `d${i}`,
      name: `案件${i}`,
      accountName: `顧客${i}`,
      amount: 1_000_000,
      probability: 50,
      yomi: "3.C",
      stage: "needs_confirmed",
      expectedCloseDate: i % 2 === 0 ? "2026-07-31" : "2026-08-20",
      nextAction: i % 3 === 0 ? null : "見積提出",
      ownerName: "橋本",
    });
  }
  const events: WeeklyEvent[] = [];
  for (let i = 0; i < 30; i++) {
    events.push(ev({ id: `e${i}`, date: WEEK, title: `商談${i}`, accountName: `顧客${i}`, stage: "proposal_sent" }));
  }
  return source({ tasks, deals, events });
}

describe("巨大マップの抑制", () => {
  it("数百件のタスクがあっても1つの枝が上限を超えない", () => {
    const spec = buildWeeklyMindmap(heavySource());
    // 上限 + 「他N件」の1ノード が最大
    const cap = Math.max(LIMITS.dayEvents, LIMITS.dayTasks, LIMITS.overdueTasks, LIMITS.dealsPerMonth) + 1;
    expect(maxChildren(spec)).toBeLessThanOrEqual(Math.max(cap, 13));
  });

  it("122件の月末タスクは上限まで畳まれ「他N件」が付く", () => {
    const spec = buildWeeklyMindmap(heavySource());
    const friday = (spec.children ?? []).find((c) => c.title === "7/31(金)");
    expect(friday).toBeTruthy();
    const more = (friday!.children ?? []).find((c) => c.title.includes("他") && c.title.includes("タスク"));
    expect(more).toBeTruthy();
    expect(more!.title).toBe(`他${122 - LIMITS.dayTasks}件のタスク（タスク一覧で確認）`);
  });

  it("期日超過168件も上限まで畳まれる", () => {
    const spec = buildWeeklyMindmap(heavySource());
    const overdue = findChild(spec, (t) => t.startsWith("期日超過タスク"));
    expect(overdue!.title).toBe("期日超過タスク 168件"); // 件数は正直に出す
    expect((overdue!.children ?? []).length).toBe(LIMITS.overdueTasks + 1); // 表示は上限+「他N件」
  });

  it("高負荷データでも総ノード数・初期表示ノード数が実用範囲に収まる", () => {
    const spec = buildWeeklyMindmap(heavySource());
    expect(countSpec(spec)).toBeLessThan(200); // 実測416ノードだった回帰
    expect(countVisible(spec)).toBeLessThan(60); // 開いた直後に読める量
  });

  it("子が多い枝は既定で折り畳まれ、ルートは常に開く", () => {
    const spec = buildWeeklyMindmap(heavySource());
    expect(spec.collapsed).toBe(false);
    const walk = (s: NodeSpec) => {
      if ((s.children ?? []).length > COLLAPSE_OVER) expect(s.collapsed).toBe(true);
      for (const c of s.children ?? []) walk(c);
    };
    for (const c of spec.children ?? []) walk(c);
  });

  it("autoCollapse はルートを開いたまま、閾値超えの枝だけ畳む", () => {
    const many = Array.from({ length: COLLAPSE_OVER + 1 }, (_, i) => ({ title: `子${i}` }));
    const out = autoCollapse({ title: "root", children: [{ title: "大きい枝", children: many }, { title: "小さい枝", children: [{ title: "子" }] }] });
    expect(out.collapsed).toBe(false);
    expect(out.children![0].collapsed).toBe(true);
    expect(out.children![1].collapsed).toBe(false);
  });
});
