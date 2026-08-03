/**
 * 受講者が添付するファイルの受け入れ判定と、モデルへ渡す量の制御。
 *
 * Claude API はリクエスト全体で 32MB という上限があり、base64 化で約1.33倍に膨らむ。
 * 会話が続くと過去の添付も毎回送り直すことになるため、
 * 「1通あたりの上限」と「履歴全体で送る合計の上限」を分けて持つ。
 * DBもプロバイダも触らない純関数なので、境界値はテストで固定できる。
 */

export type AttachmentKind = "image" | "document" | "output";

/** 画像として視覚入力に使えるMIME。 */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** 文書として読ませるMIME(PDFはページ画像＋テキストの両方が読まれる)。 */
export const DOCUMENT_MIMES = ["application/pdf"] as const;
/** テキストはそのまま本文に差し込む(専用のブロック型を増やさない)。 */
export const TEXT_MIMES = ["text/plain", "text/markdown", "text/csv"] as const;

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** 履歴全体で毎回送り直す添付の合計上限(base64膨張後に32MBを超えないための余裕込み)。 */
export const MAX_HISTORY_ATTACHMENT_BYTES = 18 * 1024 * 1024;
/** テキスト添付を本文へ差し込む際の1件あたり上限。 */
export const MAX_TEXT_ATTACHMENT_CHARS = 40_000;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

/**
 * ブラウザが送るMIMEは環境差が大きい(.md が空や application/octet-stream になる等)ので、
 * 拡張子でも判定して補う。
 */
export function normalizeMime(mime: string | null | undefined, fileName: string): string {
  const clean = (mime ?? "").split(";")[0].trim().toLowerCase();
  const known = [...IMAGE_MIMES, ...DOCUMENT_MIMES, ...TEXT_MIMES] as readonly string[];
  if (known.includes(clean)) return clean;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? clean;
}

/** 受け入れ可能なら種別、不可なら null。 */
export function detectKind(mime: string | null | undefined, fileName: string): "image" | "document" | "text" | null {
  const m = normalizeMime(mime, fileName);
  if ((IMAGE_MIMES as readonly string[]).includes(m)) return "image";
  if ((DOCUMENT_MIMES as readonly string[]).includes(m)) return "document";
  if ((TEXT_MIMES as readonly string[]).includes(m)) return "text";
  return null;
}

/** 1ファイルの受け入れ判定。問題なければ null、あればエラーメッセージ。 */
export function validateUpload(file: { fileName: string; mime: string | null; size: number }): string | null {
  if (!file.fileName?.trim()) return "ファイル名が取得できませんでした";
  if (file.size <= 0) return "空のファイルは添付できません";
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `ファイルが大きすぎます（1件 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB まで）`;
  }
  if (!detectKind(file.mime, file.fileName)) {
    return "この形式は添付できません（画像 PNG/JPEG/GIF/WebP、PDF、テキスト CSV/TXT/MD に対応）";
  }
  return null;
}

/** 1通あたりの添付点数・合計サイズの判定。 */
export function validateMessageAttachments(files: { size: number }[]): string | null {
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return `一度に添付できるのは ${MAX_ATTACHMENTS_PER_MESSAGE} 件までです`;
  }
  const total = files.reduce((acc, f) => acc + f.size, 0);
  if (total > MAX_HISTORY_ATTACHMENT_BYTES) {
    return `添付の合計が大きすぎます（${Math.floor(MAX_HISTORY_ATTACHMENT_BYTES / 1024 / 1024)}MB まで）`;
  }
  return null;
}

export interface AttachmentRef {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface MessageAttachments<T extends AttachmentRef = AttachmentRef> {
  /** 会話内の並び順(古い順)。 */
  messageId: string;
  attachments: T[];
}

export interface BudgetedAttachments<T extends AttachmentRef = AttachmentRef> {
  messageId: string;
  /** 実際にモデルへ送る添付。 */
  attachments: T[];
  /** 予算の都合で落とした添付のファイル名(本文に注記として添える)。 */
  droppedNames: string[];
}

/**
 * 履歴の添付を予算内に収める。
 *
 * 新しいメッセージの添付を優先して残す。直前の質問に紐づく資料が落ちると
 * 会話が成立しなくなるため、「古いものから落とす」を厳密に守る。
 * 落とした分はファイル名だけ残し、呼び出し側が本文へ注記を入れられるようにする。
 */
export function selectWithinBudget<T extends AttachmentRef>(
  messages: MessageAttachments<T>[],
  byteBudget = MAX_HISTORY_ATTACHMENT_BYTES,
): BudgetedAttachments<T>[] {
  const result: BudgetedAttachments<T>[] = messages.map((m) => ({
    messageId: m.messageId,
    attachments: [],
    droppedNames: [],
  }));

  let used = 0;
  // 新しい順に詰め、入らなくなったものを落とす。
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const att of messages[i].attachments) {
      if (used + att.sizeBytes <= byteBudget) {
        result[i].attachments.push(att);
        used += att.sizeBytes;
      } else {
        result[i].droppedNames.push(att.fileName);
      }
    }
    // 元の並び順に戻す(上のループは配列順に積むだけなので順序は保たれる)。
  }
  return result;
}

/**
 * 画像生成の参照に渡せるMIME。
 * gpt-image の編集エンドポイントは PNG / JPEG / WebP のみで、GIF は受け付けない
 * (添付そのものは GIF も許可しているので、ここで落として理由を伝える)。
 */
export const IMAGE_REFERENCE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

/** 参照として渡す枚数の上限。APIは16枚までだが、研修用途では手前で止める。 */
export const MAX_IMAGE_REFERENCES = 8;

/**
 * 参照画像の合計サイズの上限。
 * 1件15MBを8枚まで通すと、実体・コピー・multipart で同時に何倍も抱えることになり
 * 関数のメモリが尽きる。枚数とは別に合計でも止める。
 */
export const MAX_IMAGE_REFERENCE_BYTES = 24 * 1024 * 1024;

export interface SkippedReference {
  fileName: string;
  reason: string;
}

export interface ImageReferenceSelection<T extends AttachmentRef = AttachmentRef> {
  /** 実際に参照として渡すもの(古い順)。 */
  used: T[];
  /** 渡せなかったものと理由。黙って無視すると「効いていない」原因が分からなくなる。 */
  skipped: SkippedReference[];
}

/**
 * 添付から画像生成の参照に使えるものを選ぶ。
 *
 * 枚数が上限を超えるときは新しいものを優先する。デザインガイドを渡して作らせる用途では、
 * 直近に添付した資料が効かないと体験にならないため。
 */
export function selectImageReferences<T extends AttachmentRef>(
  attachments: T[],
  max = MAX_IMAGE_REFERENCES,
  byteBudget = MAX_IMAGE_REFERENCE_BYTES,
): ImageReferenceSelection<T> {
  const skipped: SkippedReference[] = [];
  const usable: T[] = [];

  for (const a of attachments) {
    if ((IMAGE_REFERENCE_MIMES as readonly string[]).includes(a.mime)) {
      usable.push(a);
    } else {
      skipped.push({ fileName: a.fileName, reason: "画像生成の参照は PNG / JPEG / WebP のみ使えます" });
    }
  }

  // 新しい順に詰め、枚数か合計サイズで入らなくなったものを落とす。
  const kept: T[] = [];
  const dropped: SkippedReference[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const a = usable[i];
    if (kept.length >= max) {
      dropped.push({ fileName: a.fileName, reason: `参照できるのは新しい ${max} 件までです` });
    } else if (used + a.sizeBytes > byteBudget) {
      dropped.push({
        fileName: a.fileName,
        reason: `参照画像の合計が上限（${Math.floor(byteBudget / 1024 / 1024)}MB）を超えました`,
      });
    } else {
      kept.push(a);
      used += a.sizeBytes;
    }
  }

  // 落とした分も添付順(古い順)に並べ直して返す。
  return { used: kept.reverse(), skipped: [...skipped, ...dropped.reverse()] };
}

/** 画像生成の結果に添える説明。何を参照し、何を使えなかったかを受講者に見せる。 */
export function imageResultNote(usedNames: string[], skipped: SkippedReference[]): string {
  const lines = ["（画像を生成しました）"];
  if (usedNames.length > 0) lines.push(`参照した添付: ${usedNames.join("、")}`);
  for (const s of skipped) lines.push(`注: 「${s.fileName}」は使えませんでした（${s.reason}）`);
  return lines.join("\n");
}

/** 落とした添付を本文に伝えるための注記。 */
export function droppedNote(names: string[]): string {
  if (names.length === 0) return "";
  return `\n\n（注: 添付「${names.join("」「")}」は容量の都合でこの回答には渡されていません。必要なら添付し直してください）`;
}

/**
 * ストレージのオブジェクトキーに使える形へ落とす。
 *
 * Supabase Storage のキーは ASCII しか受け付けない。日本語を含めると
 * アップロードが弾かれる（画像は連番のASCIIキーなので通り、日本語名の生成物だけが落ちる、
 * という分かりにくい壊れ方をする）。
 * 表示・ダウンロード時のファイル名は DB の file_name を使うので、
 * ここで日本語が消えても受け手には影響しない。
 */
export function storageSafeName(fileName: string, fallback = "file"): string {
  const safe = (fileName ?? "").replace(/[^\w.\-]/g, "_").replace(/_{2,}/g, "_").slice(0, 80);
  // 記号だけになった場合(日本語のみのファイル名など)は代替名にする。
  return /[\w]/.test(safe.replace(/_/g, "")) ? safe : fallback;
}

/** テキスト添付を本文へ差し込む形に整える。 */
export function inlineTextAttachment(fileName: string, text: string): string {
  const body = text.length > MAX_TEXT_ATTACHMENT_CHARS ? `${text.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n…(以下省略)` : text;
  return `\n\n## 添付ファイル: ${fileName}\n${body}`;
}
