import { describe, it, expect } from "vitest";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_HISTORY_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_CHARS,
  detectKind,
  droppedNote,
  inlineTextAttachment,
  normalizeMime,
  selectWithinBudget,
  validateMessageAttachments,
  validateUpload,
} from "@/lib/ai-lab/attachments";

describe("MIMEの正規化", () => {
  it("既知のMIMEはそのまま(charset付きも扱える)", () => {
    expect(normalizeMime("image/png", "a.png")).toBe("image/png");
    expect(normalizeMime("text/csv; charset=utf-8", "a.csv")).toBe("text/csv");
    expect(normalizeMime("IMAGE/PNG", "a.png")).toBe("image/png");
  });

  it("ブラウザがMIMEを付けない/誤る場合は拡張子で補う", () => {
    // .md は空や application/octet-stream で送られることが多い
    expect(normalizeMime("", "guide.md")).toBe("text/markdown");
    expect(normalizeMime("application/octet-stream", "report.pdf")).toBe("application/pdf");
    expect(normalizeMime(null, "photo.JPEG")).toBe("image/jpeg");
  });
});

describe("受け入れ種別の判定", () => {
  it("画像・文書・テキストを見分ける", () => {
    expect(detectKind("image/webp", "a.webp")).toBe("image");
    expect(detectKind("application/pdf", "a.pdf")).toBe("document");
    expect(detectKind("text/plain", "a.txt")).toBe("text");
  });

  it("対応外は null", () => {
    expect(detectKind("application/zip", "a.zip")).toBeNull();
    expect(detectKind("video/mp4", "a.mp4")).toBeNull();
    expect(detectKind("", "a.exe")).toBeNull();
  });
});

describe("1ファイルの受け入れ判定", () => {
  it("対応形式・上限内なら通る", () => {
    expect(validateUpload({ fileName: "a.pdf", mime: "application/pdf", size: 1000 })).toBeNull();
  });

  it("空ファイル・上限超過・対応外形式を弾く", () => {
    expect(validateUpload({ fileName: "a.pdf", mime: "application/pdf", size: 0 })).not.toBeNull();
    expect(
      validateUpload({ fileName: "a.pdf", mime: "application/pdf", size: MAX_ATTACHMENT_BYTES + 1 }),
    ).not.toBeNull();
    expect(validateUpload({ fileName: "a.zip", mime: "application/zip", size: 100 })).not.toBeNull();
  });

  it("上限ちょうどは通す(境界)", () => {
    expect(validateUpload({ fileName: "a.pdf", mime: "application/pdf", size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("ファイル名が無いものは弾く", () => {
    expect(validateUpload({ fileName: "  ", mime: "image/png", size: 10 })).not.toBeNull();
  });
});

describe("1通あたりの判定", () => {
  it("点数上限を超えたら弾く", () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => ({ size: 1 }));
    expect(validateMessageAttachments(files)).not.toBeNull();
    expect(validateMessageAttachments(files.slice(0, MAX_ATTACHMENTS_PER_MESSAGE))).toBeNull();
  });

  it("合計サイズが上限を超えたら弾く", () => {
    expect(validateMessageAttachments([{ size: MAX_HISTORY_ATTACHMENT_BYTES + 1 }])).not.toBeNull();
  });

  it("添付なしは通る", () => {
    expect(validateMessageAttachments([])).toBeNull();
  });
});

describe("履歴の添付を予算内に収める", () => {
  const att = (id: string, size: number) => ({ id, fileName: `${id}.pdf`, mime: "application/pdf", sizeBytes: size });

  it("予算内なら全部残る", () => {
    const out = selectWithinBudget(
      [
        { messageId: "m1", attachments: [att("a", 100)] },
        { messageId: "m2", attachments: [att("b", 100)] },
      ],
      1000,
    );
    expect(out[0].attachments.map((a) => a.id)).toEqual(["a"]);
    expect(out[1].attachments.map((a) => a.id)).toEqual(["b"]);
    expect(out.every((o) => o.droppedNames.length === 0)).toBe(true);
  });

  it("予算を超えたら古いものから落とす(直近の資料は必ず残す)", () => {
    const out = selectWithinBudget(
      [
        { messageId: "m1", attachments: [att("old", 100)] },
        { messageId: "m2", attachments: [att("new", 100)] },
      ],
      150,
    );
    expect(out[1].attachments.map((a) => a.id)).toEqual(["new"]);
    expect(out[0].attachments).toEqual([]);
    expect(out[0].droppedNames).toEqual(["old.pdf"]);
  });

  it("直近のメッセージに複数あっても、入る分だけ残す", () => {
    const out = selectWithinBudget([{ messageId: "m1", attachments: [att("a", 100), att("b", 100)] }], 150);
    expect(out[0].attachments).toHaveLength(1);
    expect(out[0].droppedNames).toHaveLength(1);
  });

  it("1件も入らない予算でも例外にせず、全部落としたと申告する", () => {
    const out = selectWithinBudget([{ messageId: "m1", attachments: [att("a", 100)] }], 10);
    expect(out[0].attachments).toEqual([]);
    expect(out[0].droppedNames).toEqual(["a.pdf"]);
  });

  it("添付が無いメッセージはそのまま空で返る", () => {
    const out = selectWithinBudget([{ messageId: "m1", attachments: [] }], 1000);
    expect(out).toEqual([{ messageId: "m1", attachments: [], droppedNames: [] }]);
  });
});

describe("落とした添付の注記", () => {
  it("落ちたファイル名を本文に伝える", () => {
    const note = droppedNote(["a.pdf", "b.png"]);
    expect(note).toContain("a.pdf");
    expect(note).toContain("b.png");
  });

  it("落ちていなければ何も足さない", () => {
    expect(droppedNote([])).toBe("");
  });
});

describe("テキスト添付の差し込み", () => {
  it("ファイル名つきの見出しで本文に足す", () => {
    const out = inlineTextAttachment("data.csv", "a,b\n1,2");
    expect(out).toContain("## 添付ファイル: data.csv");
    expect(out).toContain("a,b");
  });

  it("長すぎるテキストは切り詰めて省略を明示する", () => {
    const out = inlineTextAttachment("big.txt", "あ".repeat(MAX_TEXT_ATTACHMENT_CHARS + 100));
    expect(out).toContain("以下省略");
    expect(out.length).toBeLessThan(MAX_TEXT_ATTACHMENT_CHARS + 200);
  });
});
