/**
 * システムプロンプトと会話履歴の組み立て。
 *
 * 合成順は「ベースガードレール → 管理者のプリセット → 参照アセット」。
 * ガードレールを先頭に固定し、管理者プリセットから上書きできないようにしている
 * (研修環境として最低限守らせたい前提のため)。
 */

export const BASE_GUARDRAIL = [
  "あなたは企業のAI研修で使われる体験環境のアシスタントです。受講者が生成AIの実力を体感できるよう、",
  "具体的で実務に使える回答を、日本語で分かりやすく返してください。",
  "",
  "- 事実と推測は区別し、確信が持てないことは「確認が必要」と明示してください。",
  "- 受講者が業務データを貼り付けることがあります。内容は回答の生成にのみ使い、扱いは慎重にしてください。",
  "- 個人情報や機密情報の入力を求めないでください。",
  "- 違法行為・他者を害する内容の作成依頼には応じないでください。",
].join("\n");

/** プリセットのアセットをシステムプロンプトへ注入する上限(文字数)。 */
export const ASSET_INJECT_LIMIT = 24_000;

/**
 * ファイル生成が使えるときにだけ足す案内。
 * 何が作れるかを明示しないと、モデルは表をテキストで返して終わることが多い。
 */
export const FILE_TOOLS_NOTE = [
  "",
  "あなたは Excel(.xlsx)・Word(.docx)・PowerPoint(.pptx)・PDF のファイルを作成できます。",
  "- 表・集計・一覧を求められたら、本文で要点を説明したうえでファイルとしても出力してください。",
  "- 受講者が添付した資料（PDF・画像）から数値や項目を読み取って、表計算ファイルにまとめることもできます。",
  "- 日本語のファイル名を付け、列見出しと単位を明示してください。",
].join("\n");

export interface PromptPreset {
  system_prompt: string | null;
}
export interface PromptAsset {
  file_name: string;
  extracted_text: string | null;
}

export interface BuiltSystemPrompt {
  system: string;
  /** アセットが上限で切り詰められたか(管理画面の警告表示に使う)。 */
  truncated: boolean;
  /** 注入されたアセットの文字数。 */
  assetChars: number;
}

export function buildSystemPrompt(
  preset: PromptPreset | null | undefined,
  assets: PromptAsset[] = [],
  limit = ASSET_INJECT_LIMIT,
): BuiltSystemPrompt {
  const parts: string[] = [BASE_GUARDRAIL];

  const presetPrompt = preset?.system_prompt?.trim();
  if (presetPrompt) parts.push(presetPrompt);

  let assetBlock = "";
  let truncated = false;
  for (const a of assets) {
    const text = a.extracted_text?.trim();
    if (!text) continue;
    const chunk = `## 参考資料: ${a.file_name}\n${text}`;
    const separator = assetBlock ? "\n\n" : "";
    const remaining = limit - assetBlock.length - separator.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (chunk.length > remaining) {
      assetBlock += separator + chunk.slice(0, remaining);
      truncated = true;
      break;
    }
    assetBlock += separator + chunk;
  }

  if (assetBlock) {
    parts.push(
      "以下は、この体験環境のために用意された参考資料です。回答は資料のトーン・表記ルールに従ってください。\n\n" +
        assetBlock,
    );
  }

  return { system: parts.join("\n\n"), truncated, assetChars: assetBlock.length };
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** 履歴の文字数予算。超えた分は古いものから落とす。 */
export const HISTORY_CHAR_BUDGET = 60_000;

/**
 * モデルに渡す会話履歴を予算内に収める。
 * 直近から遡って詰め、最新のメッセージは予算を超えても必ず残す(質問自体が消えないように)。
 * 中身が空の行(エラー時に記録した assistant 行など)は文脈にならないので除外する。
 */
export function buildHistory<T extends HistoryMessage>(
  messages: T[],
  charBudget = HISTORY_CHAR_BUDGET,
): T[] {
  const usable = messages.filter((m) => m.content && m.content.trim().length > 0);
  const kept: T[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    if (kept.length > 0 && used + m.content.length > charBudget) break;
    kept.push(m);
    used += m.content.length;
  }
  return kept.reverse();
}
