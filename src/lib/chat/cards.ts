import type { ChatMessagePayload } from "./client";

/**
 * Google Chat メッセージ（テキスト / カード）ビルダー。
 * アプリ認証なので cardsV2（見出し・本文・リンクボタン）を利用できる。
 */

/** プレーンテキストメッセージ。 */
export function textMessage(text: string): ChatMessagePayload {
  return { text };
}

export interface CardOptions {
  title: string;
  subtitle?: string;
  /** 本文の各行（textParagraph として結合）。 */
  lines?: string[];
  /** CRM への導線ボタン。 */
  buttonText?: string;
  buttonUrl?: string;
  /**
   * リアクショントリガー(P3)照合用のタグ。カード末尾に不可視に近い形で残す。
   * 例: "danger_deal" / "digest"。
   */
  messageKind?: string;
}

/** 案件/ダイジェスト等の汎用カード。 */
export function cardMessage(opts: CardOptions): ChatMessagePayload {
  const widgets: unknown[] = [];
  if (opts.lines && opts.lines.length) {
    widgets.push({ textParagraph: { text: opts.lines.join("<br>") } });
  }
  if (opts.buttonText && opts.buttonUrl) {
    widgets.push({
      buttonList: {
        buttons: [
          {
            text: opts.buttonText,
            onClick: { openLink: { url: opts.buttonUrl } },
          },
        ],
      },
    });
  }
  const card = {
    header: opts.subtitle
      ? { title: opts.title, subtitle: opts.subtitle }
      : { title: opts.title },
    sections: [{ widgets }],
  };
  return {
    // P3: messageKind をカードIDに埋め込み、リアクション受信時に取り出せるようにする。
    cardsV2: [
      {
        cardId: opts.messageKind ? `kind:${opts.messageKind}` : "card",
        card,
      },
    ],
  };
}
