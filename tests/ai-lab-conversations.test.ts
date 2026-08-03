import { describe, it, expect } from "vitest";
import { mergeConversations, upsertConversation } from "@/lib/ai-lab/conversations";
import type { LabUiConversation } from "@/lib/ai-lab/ui-types";

const conv = (id: string, title = id): LabUiConversation => ({
  id,
  title,
  updatedAt: "2026-08-03T00:00:00.000Z",
});

describe("履歴ペインの一覧合成", () => {
  it("サーバーがまだ知らない会話を先頭に出す", () => {
    // 送信直後にここが空だと、生成が終わるまで履歴に何も出てこない。
    const merged = mergeConversations([conv("new")], [conv("old")]);
    expect(merged.map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("サーバーが追いついたら重複させない", () => {
    const merged = mergeConversations([conv("a")], [conv("a"), conv("b")]);
    expect(merged.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("サーバー側の内容を優先する(タイトルの確定版が勝つ)", () => {
    const merged = mergeConversations([conv("a", "仮タイトル")], [conv("a", "確定タイトル")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("確定タイトル");
  });

  it("どちらも空なら空", () => {
    expect(mergeConversations([], [])).toEqual([]);
  });

  it("元の配列を書き換えない", () => {
    const local = [conv("a")];
    const server = [conv("b")];
    mergeConversations(local, server);
    expect(local.map((c) => c.id)).toEqual(["a"]);
    expect(server.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("会話の差し込み", () => {
  it("先頭に入る(新しい会話が一番上)", () => {
    expect(upsertConversation([conv("a")], conv("b")).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("仮エントリは本物に置き換わる(2つ並ばない)", () => {
    // 送信時は会話IDが無いので仮IDで並べ、サーバー確定後に差し替える。
    const withTemp = upsertConversation([], conv("tmp-1", "見積の作り方"));
    const replaced = upsertConversation(withTemp, conv("real-1", "見積の作り方"), "tmp-1");
    expect(replaced.map((c) => c.id)).toEqual(["real-1"]);
  });

  it("同じIDを入れ直しても増えない", () => {
    const once = upsertConversation([conv("a")], conv("a", "改題"));
    expect(once).toHaveLength(1);
    expect(once[0].title).toBe("改題");
  });

  it("replacesId が無くても既存には影響しない", () => {
    expect(upsertConversation([conv("a"), conv("b")], conv("c")).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
});
