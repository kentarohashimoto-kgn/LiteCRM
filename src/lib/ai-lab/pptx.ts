import PptxGenJS from "pptxgenjs";

/**
 * 生成済みのスライド画像を1つの pptx にまとめる。
 *
 * 1スライド1画像を全面に敷く構成。画像の中に文字が描かれているため、
 * PowerPoint 側のテキストボックスは置かない(二重に見えてしまう)。
 * 発表者ノートだけはテキストとして入れる。ここは編集・読み上げに使えるため。
 *
 * OOXML と ZIP を自前で書くのは検証環境の都合で危ないので、生成はライブラリに任せる。
 */

export interface PptxSlideInput {
  /** PNG/JPEG の実体。 */
  data: Buffer;
  mime: string;
  notes?: string | null;
}

/** 16:9 のスライド寸法(インチ)。pptxgenjs の LAYOUT_16x9 と同じ。 */
const SLIDE_WIDTH_IN = 10;
const SLIDE_HEIGHT_IN = 5.625;

export async function buildDeckPptx(slides: PptxSlideInput[]): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";

  for (const s of slides) {
    const slide = pres.addSlide();
    slide.addImage({
      data: `${s.mime};base64,${s.data.toString("base64")}`,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH_IN,
      h: SLIDE_HEIGHT_IN,
      // 画像は 16:9 ちょうどとは限らない。切らずに全体を見せる方を優先する。
      sizing: { type: "contain", w: SLIDE_WIDTH_IN, h: SLIDE_HEIGHT_IN },
    });
    if (s.notes?.trim()) slide.addNotes(s.notes.trim());
  }

  const out = await pres.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
