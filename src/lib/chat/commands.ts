import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cardMessage, textMessage } from "./cards";
import type { ChatMessagePayload } from "./client";
import type { ResolvedSender } from "./identities";
import {
  listTaskProjects,
  listTenantMembers,
  parseTaskWithAI,
  resolveAssignee,
} from "./ai-task-parse";
import { classifyChatIntent } from "./ai-intent";
import { closingDeals, meetingsList, needsFollowup } from "./insights";

/**
 * メンション本文（argumentText: Botメンションを除いた文字列）を解釈し、
 * CRM操作を実行して返信メッセージ（カード）を組み立てる。
 *
 * P2の対応コマンド（参照＋起票。破壊的操作は含めない）:
 *   商談 <キーワード>   … 進行中商談を名称/取引先名で検索
 *   今日               … 自分の今日のAC/超過サマリ
 *   タスク <本文>       … 自分にタスクを起票（既定期限=明日、YYYY-MM-DD/明日/今日を認識）
 *   ヘルプ             … 使い方
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://lite-crm-tau.vercel.app";
}
function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function jstPlusDays(days: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
function yen(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  return `¥${(v || 0).toLocaleString("ja-JP")}`;
}

function helpCard(): ChatMessagePayload {
  return cardMessage({
    title: "CATORCE CRM の使い方",
    lines: [
      "<b>@CATORCE CRM</b> に続けて入力してください：",
      "・<b>商談 &lt;キーワード&gt;</b> — 進行中商談を検索（例: 商談 近代美術）",
      "・<b>今日</b> — 自分の今日のAC・超過を表示",
      "・<b>タスク &lt;内容&gt;</b> — タスク起票。自然文OK（例: タスク CTCに7月末までに注文書の催促。担当橋本）",
      "・自然文の質問もOK — 「<b>来週の商談を担当者別に</b>」「<b>今月成約できそうな案件は？</b>」「<b>催促すべき案件は？</b>」",
      "・<b>ヘルプ</b> — この案内",
    ],
    buttonText: "アプリを開く",
    buttonUrl: `${appUrl()}/app/today`,
  });
}

async function searchDeals(tenantId: string, kw: string): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  if (!kw) return textMessage("検索キーワードを指定してください。例）商談 近代美術");

  // 取引先名の一致から account_id を集める
  const { data: accs } = await admin
    .from("accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", `%${kw}%`)
    .limit(50);
  const accIds = (accs ?? []).map((a) => a.id as string);

  let q = admin
    .from("opportunities")
    .select("id, name, amount, stage, probability, next_action_date, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .is("deleted_at", null)
    .limit(5);
  q = accIds.length
    ? q.or(`name.ilike.%${kw}%,account_id.in.(${accIds.join(",")})`)
    : q.ilike("name", `%${kw}%`);

  const { data: opps } = await q;
  if (!opps || opps.length === 0) {
    return textMessage(`「${kw}」に一致する進行中の商談は見つかりませんでした。`);
  }
  const lines = opps.map((o) => {
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const ac = o.next_action_date ? ` / 次AC ${o.next_action_date}` : "";
    return `<b>${acc}</b>｜${o.name} — ${yen(o.amount)} / ${o.stage}(${o.probability}%)${ac}`;
  });
  return cardMessage({
    title: `商談検索: 「${kw}」 ${opps.length}件`,
    lines,
    buttonText: "商談一覧を開く",
    buttonUrl: `${appUrl()}/app/opportunities`,
  });
}

async function todaySummary(tenantId: string, userId: string): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  const today = jstToday();
  const { data: opps } = await admin
    .from("opportunities")
    .select("name, next_action_date, accounts(name)")
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", userId)
    .eq("status", "open")
    .is("deleted_at", null)
    .not("next_action_date", "is", null);

  const acToday: string[] = [];
  const overdue: string[] = [];
  for (const o of opps ?? []) {
    const acc = (o.accounts as { name?: string } | null)?.name ?? "—";
    const d = o.next_action_date as string | null;
    if (d === today) acToday.push(acc);
    else if (d && d < today) overdue.push(acc);
  }
  const lines = [
    `今日のAC: <b>${acToday.length}件</b>${acToday.length ? `（${acToday.slice(0, 5).join(" / ")}${acToday.length > 5 ? " 他" : ""}）` : ""}`,
    `⚠️ 超過AC: <b>${overdue.length}件</b>${overdue.length ? `（${overdue.slice(0, 5).join(" / ")}${overdue.length > 5 ? " 他" : ""}）` : ""}`,
  ];
  return cardMessage({
    title: `今日のサマリ（${today.slice(5)}）`,
    lines,
    buttonText: "今日のタスクを開く",
    buttonUrl: `${appUrl()}/app/today`,
  });
}

async function createTask(
  tenantId: string,
  userId: string,
  rest: string,
): Promise<ChatMessagePayload> {
  const admin = getSupabaseAdmin();
  if (!rest.trim()) {
    return textMessage("タスクの本文を入力してください。例）タスク CTCに7月末までに注文書の催促。担当橋本");
  }

  // AI解析（ANTHROPIC_API_KEY設定時）: 自然言語の期限・担当・プロジェクト・優先度を解釈。
  const [members, projects] = await Promise.all([
    listTenantMembers(tenantId),
    listTaskProjects(tenantId),
  ]);
  const ai = await parseTaskWithAI(
    rest,
    members.map((m) => m.name).filter(Boolean),
    projects.map((p) => p.name).filter(Boolean),
  );

  let title: string;
  let due: string;
  let priority: "high" | "middle" | "low" = "middle";
  let assignee: { id: string; name: string } | null = null;
  let project: { id: string; name: string } | null = null;
  let aiUsed = false;

  if (ai) {
    aiUsed = true;
    title = ai.title;
    due = ai.due_date;
    priority = ai.priority;
    assignee = resolveAssignee(ai.assignee_name, members);
    project = resolveAssignee(ai.project_name, projects);
  } else {
    // フォールバック: ルールベース（YYYY-MM-DD / 今日 / 明日 のみ認識）。
    due = jstPlusDays(1);
    title = rest;
    const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      due = dateMatch[1];
      title = rest.replace(dateMatch[1], "").trim();
    } else if (/(^|\s)今日(\s|$)/.test(rest)) {
      due = jstToday();
      title = rest.replace(/今日/, "").trim();
    } else if (/(^|\s)明日(\s|$)/.test(rest)) {
      due = jstPlusDays(1);
      title = rest.replace(/明日/, "").trim();
    }
    title = title.trim();
  }
  if (!title) return textMessage("タスクの本文を入力してください。例）タスク 見積書送付 明日");

  const assignedTo = assignee?.id ?? userId;
  const { error } = await admin.from("tasks").insert({
    tenant_id: tenantId,
    assigned_to: assignedTo,
    created_by: userId,
    title,
    due_date: due,
    status: "todo",
    priority,
    origin: "chat",
    project_id: project?.id ?? null,
  });
  if (error) return textMessage(`タスク作成に失敗しました: ${error.message}`);

  const prioLabel = priority === "high" ? "高" : priority === "low" ? "低" : "中";
  const lines = [
    `<b>${title}</b>`,
    `期限: ${due} ／ 優先度: ${prioLabel}`,
    `担当: ${assignee ? assignee.name : "自分"}${project ? ` ／ プロジェクト: ${project.name}` : ""}`,
  ];
  if (ai?.assignee_name && !assignee) {
    lines.push(`⚠️ 「${ai.assignee_name}」に一致するメンバーが見つからず、自分に割り当てました。`);
  }
  if (ai?.project_name && !project) {
    lines.push(`⚠️ 「${ai.project_name}」に一致するプロジェクトが見つかりませんでした。`);
  }
  return cardMessage({
    title: aiUsed ? "✅ タスクを起票しました（AI解釈）" : "✅ タスクを起票しました",
    lines,
    buttonText: "タスク一覧を開く",
    buttonUrl: `${appUrl()}/app/tasks`,
  });
}

/** メンション本文を解釈して実行し、返信メッセージを返す。 */
export async function executeChatCommand(
  argumentText: string,
  sender: ResolvedSender,
): Promise<ChatMessagePayload> {
  const text = (argumentText || "").trim();
  if (!text || /^(ヘルプ|help|\?|？)$/i.test(text)) return helpCard();

  const spaceIdx = text.search(/\s/);
  const head = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

  if (["商談", "案件", "deal"].includes(head)) return searchDeals(sender.tenantId, rest);
  if (["今日", "today"].includes(head)) return todaySummary(sender.tenantId, sender.userId);
  if (["タスク", "task", "todo"].includes(head)) return createTask(sender.tenantId, sender.userId, rest);

  // 固定コマンドに当たらない自由文: AIで意図分類（読み取り専用クエリのみ）。
  // APIキー未設定なら分類もメンバー取得も行わず即ヘルプへ。
  if (!process.env.ANTHROPIC_API_KEY) return helpCard();
  const members = await listTenantMembers(sender.tenantId);
  const classified = await classifyChatIntent(text, members.map((m) => m.name).filter(Boolean));
  if (classified && classified.intent !== "none") {
    // 絞り込み対象: 名指しメンバー > 「自分の」 > チーム全体
    const named = resolveAssignee(classified.member_name, members);
    const filter = named
      ? { memberId: named.id, memberLabel: named.name.split(" ")[0] || named.name }
      : classified.scope === "mine"
        ? { memberId: sender.userId, memberLabel: "自分" }
        : { memberId: null, memberLabel: null };

    if (classified.intent === "meetings_list") {
      const start = classified.start_date ?? jstPlusDays(1);
      const end = classified.end_date ?? start;
      return meetingsList(sender.tenantId, {
        start,
        end,
        groupBy: classified.group_by,
        filter,
      });
    }
    if (classified.intent === "closing_deals") {
      const month = classified.month ?? jstToday().slice(0, 7);
      return closingDeals(sender.tenantId, { month, filter });
    }
    if (classified.intent === "needs_followup") {
      return needsFollowup(sender.tenantId, { filter });
    }
  }

  // 未知コマンド: ヘルプを返す
  return helpCard();
}
