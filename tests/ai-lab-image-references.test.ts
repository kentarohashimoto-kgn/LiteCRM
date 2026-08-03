import { describe, it, expect } from "vitest";
import {
  MAX_IMAGE_REFERENCES,
  imageResultNote,
  selectImageReferences,
  type AttachmentRef,
} from "@/lib/ai-lab/attachments";

const ref = (fileName: string, mime: string, sizeBytes = 1000): AttachmentRef => ({
  id: fileName,
  fileName,
  mime,
  sizeBytes,
});
const MB = 1024 * 1024;

describe("画像生成の参照に使う添付の選定", () => {
  it("PNG・JPEG・WebP は参照に使う", () => {
    const { used, skipped } = selectImageReferences([
      ref("guide.png", "image/png"),
      ref("photo.jpg", "image/jpeg"),
      ref("logo.webp", "image/webp"),
    ]);
    expect(used.map((u) => u.fileName)).toEqual(["guide.png", "photo.jpg", "logo.webp"]);
    expect(skipped).toEqual([]);
  });

  it("PDFは参照に使えない。理由を返す(黙って無視すると効かない原因が分からない)", () => {
    const { used, skipped } = selectImageReferences([ref("デザインガイド.pdf", "application/pdf")]);
    expect(used).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].fileName).toBe("デザインガイド.pdf");
    expect(skipped[0].reason).toContain("PNG");
  });

  it("GIFは添付できるが参照には使えない(gpt-image の編集が受け付けない)", () => {
    const { used, skipped } = selectImageReferences([ref("anim.gif", "image/gif")]);
    expect(used).toEqual([]);
    expect(skipped[0].fileName).toBe("anim.gif");
  });

  it("使えるものと使えないものが混ざっても、使えるものは通す", () => {
    const { used, skipped } = selectImageReferences([
      ref("guide.png", "image/png"),
      ref("spec.pdf", "application/pdf"),
    ]);
    expect(used.map((u) => u.fileName)).toEqual(["guide.png"]);
    expect(skipped.map((s) => s.fileName)).toEqual(["spec.pdf"]);
  });

  it("上限を超えたら新しいものを残す(直近のガイドが効かないと体験にならない)", () => {
    const many = Array.from({ length: MAX_IMAGE_REFERENCES + 2 }, (_, i) => ref(`img${i}.png`, "image/png"));
    const { used, skipped } = selectImageReferences(many);
    expect(used).toHaveLength(MAX_IMAGE_REFERENCES);
    expect(used[used.length - 1].fileName).toBe(`img${MAX_IMAGE_REFERENCES + 1}.png`);
    expect(skipped.map((s) => s.fileName)).toEqual(["img0.png", "img1.png"]);
  });

  it("上限ちょうどなら何も落とさない", () => {
    const exact = Array.from({ length: MAX_IMAGE_REFERENCES }, (_, i) => ref(`img${i}.png`, "image/png"));
    expect(selectImageReferences(exact).skipped).toEqual([]);
  });

  it("添付なしでも例外にしない", () => {
    expect(selectImageReferences([])).toEqual({ used: [], skipped: [] });
  });

  it("古い順を保つ(参照の並びが呼び出しごとに変わらない)", () => {
    const { used } = selectImageReferences(
      [ref("a.png", "image/png"), ref("b.png", "image/png")],
      2,
    );
    expect(used.map((u) => u.fileName)).toEqual(["a.png", "b.png"]);
  });

  it("合計サイズでも止める(枚数だけだとメモリが尽きる)", () => {
    const { used, skipped } = selectImageReferences(
      [
        ref("old.png", "image/png", 10 * MB),
        ref("mid.png", "image/png", 10 * MB),
        ref("new.png", "image/png", 10 * MB),
      ],
      8,
      24 * MB,
    );
    // 新しい2枚が残り、古い1枚が落ちる
    expect(used.map((u) => u.fileName)).toEqual(["mid.png", "new.png"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].fileName).toBe("old.png");
    expect(skipped[0].reason).toContain("合計");
  });

  it("1枚で予算を超える場合も例外にせず理由を返す", () => {
    const { used, skipped } = selectImageReferences([ref("huge.png", "image/png", 30 * MB)], 8, 24 * MB);
    expect(used).toEqual([]);
    expect(skipped[0].fileName).toBe("huge.png");
  });

  it("落とした分も添付順(古い順)で並ぶ", () => {
    const { skipped } = selectImageReferences(
      [
        ref("a.png", "image/png", 10 * MB),
        ref("b.png", "image/png", 10 * MB),
        ref("c.png", "image/png", 10 * MB),
        ref("d.png", "image/png", 10 * MB),
      ],
      8,
      24 * MB,
    );
    expect(skipped.map((s) => s.fileName)).toEqual(["a.png", "b.png"]);
  });
});

describe("画像生成の結果に添える説明", () => {
  it("参照した添付名を出す", () => {
    const note = imageResultNote(["デザインガイド.png"], []);
    expect(note).toContain("（画像を生成しました）");
    expect(note).toContain("デザインガイド.png");
  });

  it("使えなかった添付は理由つきで出す", () => {
    const note = imageResultNote([], [{ fileName: "guide.pdf", reason: "PNG / JPEG / WebP のみ" }]);
    expect(note).toContain("guide.pdf");
    expect(note).toContain("PNG / JPEG / WebP のみ");
  });

  it("添付が無いときは余計な行を出さない", () => {
    expect(imageResultNote([], [])).toBe("（画像を生成しました）");
  });
});
