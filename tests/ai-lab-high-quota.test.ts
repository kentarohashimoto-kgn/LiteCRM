import { describe, it, expect } from "vitest";
import { HIGH_IMAGE_DAILY_LIMIT, canUseHighImages, highImageQuota } from "@/lib/ai-lab/limits";
import { SLIDE_QUALITIES, SLIDE_QUALITY_LABELS, isSlideQuality, toSlideQuality } from "@/lib/ai-lab/slides";

describe("画質Highの1日あたり枚数制限", () => {
  it("使っていなければ上限いっぱい残っている", () => {
    const q = highImageQuota(0, false);
    expect(q).toMatchObject({ used: 0, limit: HIGH_IMAGE_DAILY_LIMIT, remaining: HIGH_IMAGE_DAILY_LIMIT, exhausted: false });
  });

  it("使ったぶんだけ減る", () => {
    expect(highImageQuota(4, false).remaining).toBe(HIGH_IMAGE_DAILY_LIMIT - 4);
  });

  it("上限ちょうどで打ち止め", () => {
    const q = highImageQuota(HIGH_IMAGE_DAILY_LIMIT, false);
    expect(q.exhausted).toBe(true);
    expect(canUseHighImages(q)).toBe(false);
  });

  it("上限を超えていても残枚数はマイナスにしない", () => {
    expect(highImageQuota(HIGH_IMAGE_DAILY_LIMIT + 5, false).remaining).toBe(0);
  });

  it("免除アカウントは上限を持たない", () => {
    // 免除を「上限9999枚」で表すと、境界の実装ミスで運営が止まる。上限そのものを外す。
    const q = highImageQuota(500, true);
    expect(q.limit).toBeNull();
    expect(q.remaining).toBeNull();
    expect(q.exhausted).toBe(false);
    expect(canUseHighImages(q, 100)).toBe(true);
  });

  it("これから複数枚作るときは残枚数と突き合わせる", () => {
    const q = highImageQuota(HIGH_IMAGE_DAILY_LIMIT - 3, false);
    expect(canUseHighImages(q, 3)).toBe(true);
    expect(canUseHighImages(q, 4)).toBe(false);
  });

  it("使用量が負でも壊れない", () => {
    expect(highImageQuota(-5, false).used).toBe(0);
  });

  it("上限は10枚", () => {
    expect(HIGH_IMAGE_DAILY_LIMIT).toBe(10);
  });
});

describe("画質の受け取り", () => {
  it("3種そろっている", () => {
    expect(SLIDE_QUALITIES).toEqual(["low", "medium", "high"]);
  });

  it("正しい値はそのまま通す", () => {
    for (const q of SLIDE_QUALITIES) expect(toSlideQuality(q)).toBe(q);
  });

  it("画面からの不正な値は既定へ寄せる（プロバイダに渡して落ちないように）", () => {
    expect(toSlideQuality("ultra")).toBe("medium");
    expect(toSlideQuality(undefined)).toBe("medium");
    expect(toSlideQuality(null)).toBe("medium");
    expect(toSlideQuality(3)).toBe("medium");
  });

  it("既定値を指定できる（デッキの現在値を保つ用途）", () => {
    expect(toSlideQuality("bogus", "high")).toBe("high");
  });

  it("型ガードが効く", () => {
    expect(isSlideQuality("high")).toBe(true);
    expect(isSlideQuality("HIGH")).toBe(false);
  });

  it("全画質に表示名と補足がある", () => {
    for (const q of SLIDE_QUALITIES) {
      expect(SLIDE_QUALITY_LABELS[q].label.length).toBeGreaterThan(0);
      expect(SLIDE_QUALITY_LABELS[q].hint.length).toBeGreaterThan(0);
    }
  });

  it("Highの説明に1日の上限を書いている（押してから断られるのを避ける）", () => {
    expect(SLIDE_QUALITY_LABELS.high.hint).toContain("10枚");
  });
});
