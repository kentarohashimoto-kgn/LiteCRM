import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * P2拡張: 「タスク <自然言語>」のAI解析。
 * 例）「CTCに7月末までにメールで注文書の催促をする。担当橋本。」
 *   → { title, due_date: "2026-07-31", assignee_name: "橋本", priority }
 * ANTHROPIC_API_KEY 未設定・API失敗時は null（呼び出し側がルールベースにフォールバック）。
 */

export interface ParsedTask {
  title: string;
  due_date: string; // YYYY-MM-DD
  assignee_name: string | null;
  project_name: string | null;
  priority: "high" | "middle" | "low";
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "タスクの本文。期限表現(「7月末までに」等)と担当者指定(「担当橋本」等)を除いた、行動が分かる簡潔な日本語。",
    },
    due_date: {
      type: "string",
      format: "date",
      description:
        "期限をYYYY-MM-DD形式で。「7月末」→その月の末日、「来週金曜」等の相対表現は今日の日付から解決。指定が無ければ明日。",
    },
    assignee_name: {
      type: ["string", "null"],
      description:
        "「担当◯◯」等で指定された担当者名。メンバー一覧の表記に最も近い1名。指定なし・「自分」の場合は null。",
    },
    project_name: {
      type: ["string", "null"],
      description:
        "「◯◯に入れて」「◯◯プロジェクトの」等で指定されたプロジェクト名。プロジェクト一覧の表記に最も近い1つ。指定が無ければ null。",
    },
    priority: {
      type: "string",
      enum: ["high", "middle", "low"],
      description: "至急/最優先→high、急がない/いつでも→low、それ以外→middle。",
    },
  },
  required: ["title", "due_date", "assignee_name", "project_name", "priority"],
  additionalProperties: false,
} as const;

/** テナントのタスクプロジェクト一覧（id, 名前）。プロジェクト名の解決に使う。 */
export async function listTaskProjects(
  tenantId: string,
): Promise<Array<{ id: string; name: string }>> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("task_projects")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .limit(50);
  return (data ?? []).map((p) => ({ id: p.id as string, name: (p.name as string) ?? "" }));
}

/** テナントのメンバー一覧（id, 表示名）。担当者名の解決に使う。 */
export async function listTenantMembers(
  tenantId: string,
): Promise<Array<{ id: string; name: string }>> {
  const admin = getSupabaseAdmin();
  const { data: mems } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId);
  const ids = (mems ?? []).map((m) => m.user_id as string);
  if (ids.length === 0) return [];
  const { data: profs } = await admin
    .from("profiles")
    .select("id, display_name, email")
    .in("id", ids);
  return (profs ?? []).map((p) => ({
    id: p.id as string,
    name: ((p.display_name as string | null) || (p.email as string | null) || "").trim(),
  }));
}

function jstTodayParts(): { date: string; weekday: string } {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return { date: now.toISOString().slice(0, 10), weekday: weekdays[now.getUTCDay()] };
}

/** 自然言語のタスク指示を構造化。失敗時 null。 */
export async function parseTaskWithAI(
  text: string,
  memberNames: string[],
  projectNames: string[] = [],
): Promise<ParsedTask | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { date, weekday } = jstTodayParts();

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system:
        "あなたはB2B営業CRMのタスク起票アシスタントです。日本語のゆらぎのある指示から、タスクを正確に構造化します。" +
        "書かれていない情報を推測で補わないでください。",
      messages: [
        {
          role: "user",
          content:
            `今日は ${date}（${weekday}曜日）です。\n` +
            `チームのメンバー一覧: ${memberNames.length ? memberNames.join(" / ") : "(なし)"}\n` +
            `プロジェクト一覧: ${projectNames.length ? projectNames.join(" / ") : "(なし)"}\n\n` +
            `次のタスク指示を構造化してください:\n${text}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") return null;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = JSON.parse(block.text) as ParsedTask;
    if (!parsed.title || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.due_date)) return null;
    return parsed;
  } catch {
    return null; // ルールベースにフォールバック
  }
}

/** 担当者名をメンバーに解決（部分一致・大小無視）。 */
export function resolveAssignee(
  name: string | null,
  members: Array<{ id: string; name: string }>,
): { id: string; name: string } | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\s/g, "");
  return (
    members.find((m) => {
      const mn = m.name.toLowerCase().replace(/\s/g, "");
      return mn.includes(n) || n.includes(mn.split("@")[0]);
    }) ?? null
  );
}
