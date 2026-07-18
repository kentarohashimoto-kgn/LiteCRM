/**
 * AI-PMO: ベテランPMアドバイザーの純ロジック層。
 *
 * 4つの視点で仕事を見るスーパーアドバイザーPM:
 *  - 鳥の目: 全体を俯瞰(パイプライン・目標乖離・PJ全体の健全性)
 *  - 虫の目: 個別案件・タスクの詳細(期限・次アクション・停滞)
 *  - 魚の目: 流れ・トレンド(月次推移・ヨミの動き・活動量)
 *  - コウモリの目: 逆さの視点(ヌケモレ・思い込み・放置リスクの指摘)
 *
 * このファイルはDB非依存(引数に軽量行を受け取る)。ヌケモレ検知は
 * ルールベースで決定的に行い、AI無しでも画面に出す。AI呼び出し時は
 * buildPmoDigest() の出力をプロンプトに埋め込む。
 */
import { STALE_DAYS } from "@/lib/constants";
import { daysBetween } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 入力行型(必要最小限のカラムのみ。server action 側の select と一致させる)
// ---------------------------------------------------------------------------

export type PmoOppRow = {
  id: string;
  name: string;
  account_name?: string | null;
  owner_name?: string | null;
  status: string; // open/won/lost
  yomi?: string | null;
  stage?: string | null;
  amount?: number | null;
  probability?: number | null;
  expected_close_date?: string | null;
  expected_revenue_month?: string | null;
  next_action_date?: string | null;
  next_action_text?: string | null;
  last_activity_at?: string | null;
  first_meeting_date?: string | null;
  appointment_at?: string | null;
  is_project_managed?: boolean | null;
  risk_level?: string | null;
  customer_issue?: string | null;
  competitor?: string | null;
  updated_at?: string | null;
};

export type PmoTaskRow = {
  id: string;
  title: string;
  status: string; // todo/done/cancelled/overdue
  due_date: string | null;
  priority?: string | null;
  assignee_name?: string | null;
  opportunity_id?: string | null;
  completed_at?: string | null;
};

export type PmoMeetingRow = {
  id: string;
  title: string;
  meeting_date: string | null;
  opportunity_id: string;
  opportunity_name?: string | null;
  summary?: string | null;
  ai_summary?: string | null;
  next_action_date?: string | null;
  next_action_text?: string | null;
};

export type PmoProjectRow = {
  plan_id: string;
  opportunity_id: string;
  name: string;
  account_name?: string | null;
  status: string; // planning/baselined/in_progress/closed
  priority?: string | null;
  start_month?: string | null;
  end_month?: string | null;
  latest_report?: {
    week_start?: string | null;
    status?: string | null; // on_track/watch/over/blocked
    progress_pct?: number | null;
    planned_mm?: number | null;
    actual_mm?: number | null;
    blockers?: string | null;
  } | null;
};

export type PmoMonthRow = {
  month: string; // YYYY-MM
  target: number;
  actual: number; // 受注済み実績
  weighted: number; // ヨミ加重パイプライン
};

export type PmoInput = {
  opps: PmoOppRow[];
  tasks: PmoTaskRow[];
  meetings: PmoMeetingRow[];
  projects: PmoProjectRow[];
  months: PmoMonthRow[];
  today: string; // YYYY-MM-DD (JST基準で呼び出し側が確定)
};

// ---------------------------------------------------------------------------
// ルールベースのヌケモレ検知(コウモリの目・決定的)
// ---------------------------------------------------------------------------

export type PmoAlertSeverity = "high" | "mid" | "low";

export type PmoAlert = {
  key: string;
  severity: PmoAlertSeverity;
  category: string; // 表示用カテゴリ
  title: string;
  detail: string;
  href?: string; // 該当画面への導線
};

/** 受注/失注/キャンセル等を除いた「動いている」ヨミか */
export function isActiveYomi(yomi: string | null | undefined): boolean {
  if (!yomi) return true; // 未設定は動いている扱い(むしろ指摘対象)
  return !/^(0\.|7\.|8\.)/.test(yomi); // 0.受注 / 7.オチ / 8.キャンセル を除外
}

function d(value: string): Date {
  return new Date(value + (value.length === 10 ? "T00:00:00+09:00" : ""));
}

/** 期限切れ・停滞・未設定などのヌケモレをルールで検知する。 */
export function detectPmoAlerts(input: PmoInput): PmoAlert[] {
  const alerts: PmoAlert[] = [];
  const today = d(input.today);
  const openOpps = input.opps.filter((o) => o.status === "open" && isActiveYomi(o.yomi));

  // --- タスク: 期限切れ(虫の目) ---
  const overdueTasks = input.tasks.filter(
    (t) => (t.status === "todo" || t.status === "overdue") && t.due_date && d(t.due_date) < today,
  );
  for (const t of overdueTasks.slice(0, 30)) {
    const days = daysBetween(today, d(t.due_date!));
    alerts.push({
      key: `task-overdue-${t.id}`,
      severity: days >= 7 || t.priority === "high" ? "high" : "mid",
      category: "期限切れタスク",
      title: t.title,
      detail: `期限を${days}日超過${t.assignee_name ? `(担当: ${t.assignee_name})` : ""}。完了報告か期限の再設定を。`,
      href: "/app/tasks",
    });
  }

  for (const o of openOpps) {
    const label = `${o.account_name ? o.account_name + "｜" : ""}${o.name}`;

    // --- 次アクション未設定(コウモリの目: 「進んでいるつもり」の検知) ---
    if (!o.next_action_text && !o.next_action_date) {
      alerts.push({
        key: `opp-no-next-${o.id}`,
        severity: "high",
        category: "次アクション未設定",
        title: label,
        detail: "次の一手が決まっていません。放置案件化する前に次アクションと期日を設定してください。",
        href: `/app/opportunities/${o.id}`,
      });
    } else if (o.next_action_date && d(o.next_action_date) < today) {
      const days = daysBetween(today, d(o.next_action_date));
      alerts.push({
        key: `opp-next-overdue-${o.id}`,
        severity: days >= 7 ? "high" : "mid",
        category: "次アクション期限切れ",
        title: label,
        detail: `「${o.next_action_text ?? "次アクション"}」の予定日を${days}日超過。実施済みなら更新、未実施なら今日やる。`,
        href: `/app/opportunities/${o.id}`,
      });
    }

    // --- クローズ予定日超過(虫の目) ---
    if (o.expected_close_date && d(o.expected_close_date) < today) {
      const days = daysBetween(today, d(o.expected_close_date));
      alerts.push({
        key: `opp-close-passed-${o.id}`,
        severity: days >= 14 ? "high" : "mid",
        category: "クローズ予定超過",
        title: label,
        detail: `受注予定日を${days}日超過したままオープン。ヨミ(${o.yomi ?? "未設定"})と予定日の見直しを。`,
        href: `/app/opportunities/${o.id}`,
      });
    }

    // --- 停滞(魚の目: 流れが止まった) ---
    const lastTouch = o.last_activity_at ?? o.updated_at;
    if (lastTouch) {
      const days = daysBetween(today, new Date(lastTouch));
      if (days >= STALE_DAYS * 2) {
        alerts.push({
          key: `opp-stale-${o.id}`,
          severity: days >= STALE_DAYS * 4 ? "high" : "mid",
          category: "停滞案件",
          title: label,
          detail: `最終活動から${days}日間動きなし。顧客の温度が下がる前に接点を作ってください。`,
          href: `/app/opportunities/${o.id}`,
        });
      }
    }

    // --- ヨミ未設定(鳥の目: 予測の土台が崩れる) ---
    if (!o.yomi) {
      alerts.push({
        key: `opp-no-yomi-${o.id}`,
        severity: "low",
        category: "ヨミ未設定",
        title: label,
        detail: "ヨミが未設定のため売上予測に乗りません。設定してください。",
        href: `/app/opportunities/${o.id}`,
      });
    }
  }

  // --- 商談後フォロー漏れ(コウモリの目) ---
  for (const m of input.meetings) {
    if (!m.meeting_date) continue;
    const days = daysBetween(today, d(m.meeting_date));
    if (days >= 3 && days <= 30 && !m.next_action_text && !m.next_action_date) {
      const opp = input.opps.find((o) => o.id === m.opportunity_id);
      if (opp && opp.status === "open" && !opp.next_action_text) {
        alerts.push({
          key: `meeting-no-followup-${m.id}`,
          severity: days >= 7 ? "high" : "mid",
          category: "商談後フォロー漏れ",
          title: `${m.opportunity_name ?? opp.name}｜${m.title}`,
          detail: `商談から${days}日、次アクションが未設定です。お礼・議事録送付・次回設定を確認してください。`,
          href: `/app/opportunities/${m.opportunity_id}`,
        });
      }
    }
  }

  // --- デリバリーPJ: ブロッカー/遅延/工数超過(虫の目+鳥の目) ---
  for (const p of input.projects) {
    if (p.status === "closed") continue;
    const r = p.latest_report;
    if (!r) {
      if (p.status === "in_progress") {
        alerts.push({
          key: `pj-no-report-${p.plan_id}`,
          severity: "mid",
          category: "PJ報告なし",
          title: p.name,
          detail: "進行中なのに週次報告がありません。進捗の見える化を。",
          href: "/app/projects",
        });
      }
      continue;
    }
    if (r.status === "blocked") {
      alerts.push({
        key: `pj-blocked-${p.plan_id}`,
        severity: "high",
        category: "PJブロッカー",
        title: p.name,
        detail: `ブロッカー発生中: ${r.blockers ?? "詳細未記入"}。解消の打ち手と期限を決めてください。`,
        href: "/app/projects",
      });
    } else if (r.status === "over" || r.status === "watch") {
      alerts.push({
        key: `pj-watch-${p.plan_id}`,
        severity: r.status === "over" ? "high" : "mid",
        category: r.status === "over" ? "PJ工数超過" : "PJ要注意",
        title: p.name,
        detail:
          r.planned_mm != null && r.actual_mm != null && r.actual_mm > r.planned_mm
            ? `工数が予定${r.planned_mm}人月に対し実績${r.actual_mm}人月。採算悪化の兆候です。`
            : `進捗${r.progress_pct ?? "?"}%・状態「${r.status}」。原因の特定を。`,
        href: "/app/projects",
      });
    }
    if (r.week_start && daysBetween(today, d(r.week_start)) >= 14 && p.status === "in_progress") {
      alerts.push({
        key: `pj-report-stale-${p.plan_id}`,
        severity: "mid",
        category: "PJ報告が古い",
        title: p.name,
        detail: `最終週次報告が${r.week_start}のまま。最新の進捗報告を依頼してください。`,
        href: "/app/projects",
      });
    }
  }

  const order: Record<PmoAlertSeverity, number> = { high: 0, mid: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ---------------------------------------------------------------------------
// AI用データダイジェスト(コンパクトなテキスト化)
// ---------------------------------------------------------------------------

function yen(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${Math.round(n / 10000).toLocaleString()}万円`;
}

function line(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" / ");
}

/** CRM横断データをAIプロンプト用のコンパクトなテキストにする。 */
export function buildPmoDigest(input: PmoInput, alerts: PmoAlert[]): string {
  const openOpps = input.opps
    .filter((o) => o.status === "open" && isActiveYomi(o.yomi))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  const recentWon = input.opps.filter((o) => o.status === "won").slice(0, 15);
  const recentLost = input.opps.filter((o) => o.status === "lost").slice(0, 15);
  const openTasks = input.tasks.filter((t) => t.status === "todo" || t.status === "overdue");

  const sections: string[] = [];

  sections.push(
    `# 月次 目標vs実績vsヨミ加重パイプライン\n` +
      input.months
        .map((m) => `- ${m.month}: 目標${yen(m.target)} / 受注実績${yen(m.actual)} / ヨミ加重${yen(m.weighted)}`)
        .join("\n"),
  );

  sections.push(
    `# 進行中の営業案件 (${openOpps.length}件, 金額降順・上位${Math.min(openOpps.length, 40)}件)\n` +
      openOpps
        .slice(0, 40)
        .map((o) =>
          line([
            `- [${o.yomi ?? "ヨミ未設定"}] ${o.account_name ?? ""}｜${o.name}`,
            yen(o.amount),
            o.owner_name ? `担当:${o.owner_name}` : null,
            o.expected_close_date ? `受注予定:${o.expected_close_date}` : "受注予定日なし",
            o.next_action_text ? `次AC:${o.next_action_text}(${o.next_action_date ?? "期日なし"})` : "次AC未設定",
            o.risk_level ? `リスク:${o.risk_level}` : null,
            o.competitor ? `競合:${o.competitor}` : null,
          ]),
        )
        .join("\n"),
  );

  if (recentWon.length || recentLost.length) {
    sections.push(
      `# 直近の受注/失注\n` +
        recentWon.map((o) => `- 受注: ${o.account_name ?? ""}｜${o.name} ${yen(o.amount)}`).join("\n") +
        (recentLost.length
          ? "\n" + recentLost.map((o) => `- 失注: ${o.account_name ?? ""}｜${o.name} ${yen(o.amount)}`).join("\n")
          : ""),
    );
  }

  sections.push(
    `# デリバリーPJ (${input.projects.length}件)\n` +
      (input.projects.length
        ? input.projects
            .map((p) => {
              const r = p.latest_report;
              return line([
                `- ${p.account_name ?? ""}｜${p.name}`,
                `状態:${p.status}`,
                p.end_month ? `終了予定:${p.end_month.slice(0, 7)}` : null,
                r
                  ? `週次:${r.status ?? "?"} 進捗${r.progress_pct ?? "?"}% 工数 予定${r.planned_mm ?? "?"}→実績${r.actual_mm ?? "?"}人月${r.blockers ? ` ブロッカー:${r.blockers}` : ""}`
                  : "週次報告なし",
              ]);
            })
            .join("\n")
        : "(なし)"),
  );

  sections.push(
    `# オープンタスク (${openTasks.length}件, 期限順・上位30件)\n` +
      openTasks
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
        .slice(0, 30)
        .map((t) => line([`- ${t.title}`, `期限:${t.due_date ?? "なし"}`, t.assignee_name ? `担当:${t.assignee_name}` : null, t.priority ? `優先度:${t.priority}` : null]))
        .join("\n"),
  );

  sections.push(
    `# 直近の商談メモ (新しい順・上位20件)\n` +
      input.meetings
        .slice(0, 20)
        .map((m) => {
          const memo = (m.ai_summary ?? m.summary ?? "").replace(/\s+/g, " ").slice(0, 200);
          return `- ${m.meeting_date ?? "?"} ${m.opportunity_name ?? ""}｜${m.title}${memo ? `: ${memo}` : ""}`;
        })
        .join("\n"),
  );

  sections.push(
    `# ルールベース検知済みのヌケモレアラート (${alerts.length}件)\n` +
      (alerts.length
        ? alerts
            .slice(0, 40)
            .map((a) => `- [${a.severity}] ${a.category}: ${a.title} — ${a.detail}`)
            .join("\n")
        : "(なし)"),
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// AIプロンプト(モード定義)
// ---------------------------------------------------------------------------

export type PmoMode = "retrospective" | "planning" | "project" | "executive";

export const PMO_MODES: { key: PmoMode; label: string; desc: string; emoji: string }[] = [
  {
    key: "retrospective",
    label: "振り返り・PDCA",
    desc: "過去の実施状況をPDCAで棚卸し。やるべきことのヌケモレを指摘し、改善提案と催促リストを作る。",
    emoji: "🔍",
  },
  {
    key: "planning",
    label: "未来への段取り",
    desc: "明日の商談準備・今週の段取り・月末クロージング・来月の仕込み・既存顧客アップセルを具体化する。",
    emoji: "🗓️",
  },
  {
    key: "project",
    label: "案件・PJ管理",
    desc: "営業フェーズの商談とデリバリーフェーズのPJを横断レビュー。リスク・遅延・採算を管理する。",
    emoji: "📦",
  },
  {
    key: "executive",
    label: "経営俯瞰",
    desc: "目標と実績・パイプライン・トレンドから経営全体を分析し、優先すべき経営アクションを提言する。",
    emoji: "🦅",
  },
];

export const PMO_MODE_MAP = Object.fromEntries(PMO_MODES.map((m) => [m.key, m]));

/** ベテランPMアドバイザーの人格・視点を定義するシステムプロンプト。 */
export const PMO_SYSTEM_PROMPT =
  "あなたはB2B営業・デリバリー現場を20年以上見てきたベテランPMO(スーパーアドバイザーPM)です。" +
  "CRMの実データだけを根拠に、頼れる先輩として具体的で実行可能な指摘と段取りを日本語で示します。\n" +
  "常に4つの視点を使い分けてください:\n" +
  "- 鳥の目(俯瞰): 全体像・目標との乖離・優先順位\n" +
  "- 虫の目(詳細): 個別案件・タスクの期限/次アクション/担当の具体確認\n" +
  "- 魚の目(トレンド): 月次推移・ヨミの流れ・活動量の変化から潮目を読む\n" +
  "- コウモリの目(逆視点): 「順調に見えるものほど疑う」。ヌケモレ・思い込み・放置・楽観ヨミを逆さから点検する\n" +
  "ルール:\n" +
  "- データに無いことは推測で断定しない。仮説は「仮説:」と明示する\n" +
  "- 指摘には必ず「誰が・何を・いつまでに」の形で次の一手を付ける\n" +
  "- 金額・件数は与えられたデータの数字を使う\n" +
  "- 厳しい指摘も遠慮しないが、責めるのではなく前に進める言い方をする\n" +
  "- 出力はMarkdown(## 見出し、箇条書き、必要なら表)で簡潔に。最重要事項から書く";

/** モード別のユーザープロンプト(ダイジェストの前に置く指示文)。 */
export function pmoModeInstruction(mode: PmoMode, today: string): string {
  switch (mode) {
    case "retrospective":
      return (
        `今日は${today}です。以下のCRMデータをもとに「振り返り・PDCA分析」レポートを作成してください。\n` +
        "構成:\n" +
        "## 総評(鳥の目)\n- 直近の受注/失注・活動の実施状況を3〜5行で\n" +
        "## PDCA分析\n- Plan(計画されていたこと) / Do(実際にやったこと) / Check(結果と差分) / Act(次に変えること)\n" +
        "## ヌケモレ指摘・催促リスト(コウモリの目)\n- 検知済みアラートを重要度順に精査し、「誰が・何を・いつまでに」の催促形式で。アラートに無い見落としも逆視点で点検\n" +
        "## 改善提案\n- 仕組み・習慣として直すべきこと(最大5つ、効果が大きい順)"
      );
    case "planning":
      return (
        `今日は${today}です。以下のCRMデータをもとに「未来への段取り」レポートを作成してください。\n` +
        "構成:\n" +
        "## 明日・直近の商談/作業の準備\n- 直近の商談/次アクション予定に対する具体的な準備とアドバイス(虫の目)\n" +
        "## 今週〜来週の段取り\n- 曜日/優先度つきの段取り表\n" +
        "## 今月末クロージングプラン(魚の目)\n- 月内に受注しうる案件と、クロージングまでの逆算ステップ\n" +
        "## 来月の仕込み\n- 今から動かないと来月困ること\n" +
        "## 既存顧客アップセル・フォローアップ\n- 受注済み/デリバリー中の顧客への次の提案機会"
      );
    case "project":
      return (
        `今日は${today}です。以下のCRMデータをもとに「案件・PJ管理」レポートを作成してください。\n` +
        "構成:\n" +
        "## 営業フェーズ(商談)の状況(鳥の目→虫の目)\n- ヨミ別の全体感と、要介入案件トップ5(理由と打ち手つき)\n" +
        "## デリバリーフェーズ(PJ)の状況\n- 各PJの健全性・ブロッカー・工数/採算リスクと打ち手\n" +
        "## 営業→デリバリーの引き継ぎ・リソースの流れ(魚の目)\n- 受注見込みとデリバリー稼働の先読み\n" +
        "## リスクトップ3と対策(コウモリの目)\n- 見落とされがちなリスクを逆視点で"
      );
    case "executive":
      return (
        `今日は${today}です。以下のCRMデータをもとに「経営俯瞰」レポートを作成してください。\n` +
        "構成:\n" +
        "## 経営サマリー(鳥の目)\n- 目標達成の見通しを結論から。着地予想と根拠\n" +
        "## トレンド分析(魚の目)\n- 月次推移・パイプラインの流れ・受注/失注傾向から読める潮目\n" +
        "## ギャップと打ち手\n- 目標との差分を埋める具体策(インパクト見積りつき)\n" +
        "## 死角の点検(コウモリの目)\n- 数字に表れていないリスク・楽観バイアスの指摘\n" +
        "## 経営アクション提言\n- 今月やるべき意思決定を優先度順に最大5つ"
      );
  }
}
