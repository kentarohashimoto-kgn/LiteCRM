import Anthropic from "@anthropic-ai/sdk";

/**
 * P2拡張: 固定コマンドに当たらない自由文の意図分類（AIルーター）。
 * 意図＋パラメータ（期間・グルーピング・メンバー絞り込み）を抽出し、
 * AIにはDBを触らせない（クエリは固定・読み取り専用）。
 * ANTHROPIC_API_KEY 未設定・失敗時は null（呼び出し側はヘルプ表示にフォールバック）。
 */

export type ChatIntent =
  | "meetings_list" // 商談・アポの一覧（期間指定: 明日/今週/来週など）
  | "closing_deals" // 成約見込みの案件（月指定: 今月/来月など）
  | "needs_followup" // 催促・フォローが必要な案件
  | "create_task" // タスクの追加・起票（断片的な単語の羅列も含む）
  | "none";

export interface ClassifiedIntent {
  intent: ChatIntent;
  start_date: string | null; // meetings_list: 期間開始 YYYY-MM-DD
  end_date: string | null; // meetings_list: 期間終了（含む）
  month: string | null; // closing_deals: 対象月 YYYY-MM
  group_by: "time" | "owner"; // owner=担当者別にまとめる
  member_name: string | null; // 特定メンバーの指定（「村上の」等）
  scope: "mine" | "team";
}

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["meetings_list", "closing_deals", "needs_followup", "create_task", "none"],
      description:
        "meetings_list=商談/アポ/予定の一覧(期間付き)。closing_deals=成約・受注できそうな案件。needs_followup=催促/フォロー/放置気味の案件。" +
        "create_task=タスクの追加/起票/登録の指示（「〜に追加」「〜タスク」「なるはや」等を含む断片的な単語の羅列や、やるべき作業内容の列挙もこれ。一覧の要求ではなく作業の登録依頼ならこれ）。" +
        "どれでもなければ none。",
    },
    start_date: {
      type: ["string", "null"],
      description:
        "meetings_list の期間開始日(YYYY-MM-DD)。「明日」「今週(今日〜日曜)」「来週(次の月曜〜日曜)」等を今日の日付から解決。meetings_list 以外は null。",
    },
    end_date: {
      type: ["string", "null"],
      description: "meetings_list の期間終了日(YYYY-MM-DD、この日を含む)。単日なら start_date と同じ。",
    },
    month: {
      type: ["string", "null"],
      description: "closing_deals の対象月(YYYY-MM)。「今月」「来月」を解決。指定なければ今月。closing_deals 以外は null。",
    },
    group_by: {
      type: "string",
      enum: ["time", "owner"],
      description: "「担当者別」「人ごと」等の指定があれば owner、なければ time。",
    },
    member_name: {
      type: ["string", "null"],
      description: "「◯◯さんの」等で特定メンバーが指定されていればその名前(メンバー一覧に最も近い表記)。なければ null。",
    },
    scope: {
      type: "string",
      enum: ["mine", "team"],
      description: "「自分の」「私の」なら mine、それ以外は team。",
    },
  },
  required: ["intent", "start_date", "end_date", "month", "group_by", "member_name", "scope"],
  additionalProperties: false,
} as const;

function jstTodayParts(): { date: string; weekday: string } {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return { date: now.toISOString().slice(0, 10), weekday: weekdays[now.getUTCDay()] };
}

export async function classifyChatIntent(
  text: string,
  memberNames: string[] = [],
): Promise<ClassifiedIntent | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { date, weekday } = jstTodayParts();
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 300,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: INTENT_SCHEMA },
      },
      system:
        "あなたはB2B営業CRMのチャットボットの意図分類器です。日本語の問いかけを分類し、期間等のパラメータを抽出します。" +
        "週の定義: 今週=今日からこの日曜まで、来週=次の月曜から日曜まで。",
      messages: [
        {
          role: "user",
          content:
            `今日は ${date}（${weekday}曜日）です。\n` +
            `メンバー一覧: ${memberNames.length ? memberNames.join(" / ") : "(なし)"}\n\n` +
            `次の問いかけを分類してください:\n${text}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = JSON.parse(block.text) as ClassifiedIntent;
    // 日付形式の軽い検証（不正ならAI結果を捨てる）
    const okDate = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s);
    const okMonth = (s: string | null) => s === null || /^\d{4}-\d{2}$/.test(s);
    if (!okDate(parsed.start_date) || !okDate(parsed.end_date) || !okMonth(parsed.month)) return null;
    return parsed;
  } catch {
    return null;
  }
}
