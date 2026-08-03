import { describe, it, expect } from "vitest";
import { buildDeckPptx, PPTX_MIME } from "@/lib/ai-lab/pptx";

/**
 * PPTX生成はライブラリ任せだが、「生成物がPowerPointで開けるファイルになっているか」は
 * この環境では実際に開いて確かめられない。せめて OOXML パッケージとしての体裁
 * （ZIP であること・必要なパートが入っていること・枚数が合っていること）を固定する。
 */

// 1x1 の PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** ZIP のセントラルディレクトリからファイル名を拾う(展開はしない)。 */
function zipEntries(buf: Buffer): string[] {
  const names: string[] = [];
  const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // central directory header
  let i = 0;
  for (;;) {
    const at = buf.indexOf(sig, i);
    if (at < 0) break;
    const nameLen = buf.readUInt16LE(at + 28);
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"));
    i = at + 46 + nameLen;
  }
  return names;
}

describe("PPTXの組み立て", () => {
  it("ZIPとして始まる(pptxはOOXMLのZIPパッケージ)", async () => {
    const buf = await buildDeckPptx([{ data: PNG, mime: "image/png" }]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("スライドの数だけ slide パートができる", async () => {
    const buf = await buildDeckPptx([
      { data: PNG, mime: "image/png" },
      { data: PNG, mime: "image/png" },
      { data: PNG, mime: "image/png" },
    ]);
    const slides = zipEntries(buf).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
  });

  it("必須パートが揃っている", async () => {
    const entries = zipEntries(await buildDeckPptx([{ data: PNG, mime: "image/png" }]));
    expect(entries).toContain("[Content_Types].xml");
    expect(entries).toContain("ppt/presentation.xml");
    expect(entries.some((n) => n.startsWith("ppt/slideMasters/"))).toBe(true);
  });

  it("画像が同梱される", async () => {
    const entries = zipEntries(await buildDeckPptx([{ data: PNG, mime: "image/png" }]));
    expect(entries.some((n) => n.startsWith("ppt/media/"))).toBe(true);
  });

  it("発表者ノートを入れるとノートのパートができる", async () => {
    const withNotes = zipEntries(
      await buildDeckPptx([{ data: PNG, mime: "image/png", notes: "ここで挨拶する" }]),
    );
    expect(withNotes.some((n) => n.startsWith("ppt/notesSlides/"))).toBe(true);
  });

  it("ノートが空白・未指定でも壊れない", async () => {
    // 構成案でノートを書かなかったスライドが混ざるのは普通のこと。
    // 空文字・空白・undefined のどれでも、スライド数の揃ったデッキになること。
    const buf = await buildDeckPptx([
      { data: PNG, mime: "image/png", notes: "   " },
      { data: PNG, mime: "image/png", notes: null },
      { data: PNG, mime: "image/png" },
    ]);
    const slides = zipEntries(buf).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
  });

  it("0枚でも例外にしない(呼び出し側で弾く前提だが落ちないこと)", async () => {
    const buf = await buildDeckPptx([]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("MIMEは PowerPoint のもの", () => {
    expect(PPTX_MIME).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  });
});
