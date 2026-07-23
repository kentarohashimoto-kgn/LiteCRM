import Anthropic from "@anthropic-ai/sdk";

/**
 * P2拡張: 固定コマンドに当たらない自由文の意図分類（AIルーター）。
 * 対応意図のみ enum で返し、AIにはDBを触らせない（クエリは固定・読み取り専用）。
 * ANTHROPIC_API_KEY 未設定・失敗時は null（呼び出し側はヘルプ表示にフォールバック）。
 */

export type ChatIntent =
  | "tomorrow_meetings" // 明日の商談・アポ一覧
  | "closing_this_month" // 今月成約見込みの案件
  | "needs_followup" // 催促・フォローが必要な案件
  | "none";

export interface ClassifiedIntent {
  intent: ChatIntent;
  scope: "mine" | "team";
}

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["tomorrow_meetings", "closing_this_month", "needs_followup", "none"],
      description:
        "tomorrow_meetings=明日の商談/アポ/予定の一覧。closing_this_month=今月成約・受注できそうな案件。needs_followup=催促/フォロー/放置気味/連絡すべき案件。どれにも該当しなければ none。",
    },
    scope: {
      type: "string",
      enum: ["mine", "team"],
      description: "「自分の」「私の」等の限定があれば mine、なければ team。",
    },
  },
  required: ["intent", "scope"],
  additionalProperties: false,
} as const;

export async function classifyChatIntent(text: string): Promise<ClassifiedIntent | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 150,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: INTENT_SCHEMA },
      },
      system:
        "あなたはB2B営業CRMのチャットボットの意図分類器です。ユーザーの日本語の問いかけを分類します。",
      messages: [{ role: "user", content: `次の問いかけを分類してください:\n${text}` }],
    });
    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    return JSON.parse(block.text) as ClassifiedIntent;
  } catch {
    return null;
  }
}
