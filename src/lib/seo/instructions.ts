/**
 * 実行指示書の生成（純関数・テスト対象）。
 *
 * 承認した提案を、HP保守担当がそのまま作業できる形にする。
 * AIが未稼働でも成立させるため、決定的テンプレートで生成する
 * （AIは後から「案の中身」を上書きするだけ）。
 *
 * HP本体への自動デプロイはしない（v1）。事故時の影響が大きいため、
 * 「指示書を渡す → 反映されたら記録する」の運用で回す。
 */

export type ExecutionMode = "external" | "content" | "app" | "manual";

/** 施策タイプ → 実行モード。誰が作業するかが決まる。 */
export const EXECUTION_MODE: Record<string, ExecutionMode> = {
  title_meta: "external", // HP側でタイトル/メタを差し替え
  internal_link: "external",
  merge_pages: "external",
  technical: "external",
  cta_form: "external",
  rewrite: "content", // 記事パイプライン(content_ideas)で改稿
  new_article: "content",
};

export interface ActionContext {
  actionType: string;
  siteName: string;
  baseUrl: string;
  targetQuery: string;
  targetPage: string;
  evidence: Record<string, unknown>;
  expected: Record<string, number>;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const dec = (n: number) => String(Math.round(n * 10) / 10);

/** 対象URLを絶対URLで組み立てる（指示書を受け取る人がそのまま開けるように）。 */
export function absoluteUrl(baseUrl: string, path: string): string {
  if (!path) return baseUrl;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

/** 期待効果の共通フッター。なぜこの作業に価値があるかを受け取る側に伝える。 */
function expectedBlock(expected: Record<string, number>): string {
  const rev = Number(expected.revenue ?? 0);
  const lines = [
    `- 追加見込みクリック: +${dec(Number(expected.clicks ?? 0))}/月`,
    `- 追加見込み問合せ: +${dec(Number(expected.inquiries ?? 0))}/月`,
  ];
  if (rev > 0) lines.push(`- 期待売上: ${yen(rev)}/月`);
  return `## 期待効果（CRM実績から換算）\n${lines.join("\n")}`;
}

/** 根拠数値のブロック。「なぜ今これをやるのか」の裏付け。 */
function evidenceBlock(evidence: Record<string, unknown>): string {
  const skip = new Set(["kind", "detected"]);
  const rows = Object.entries(evidence)
    .filter(([k, v]) => !skip.has(k) && v != null && v !== "")
    .map(([k, v]) => `- ${LABELS[k] ?? k}: ${String(v)}`);
  const detected = evidence.detected ? `${String(evidence.detected)}\n\n` : "";
  return `## 現状（検出結果）\n${detected}${rows.join("\n")}`;
}

const LABELS: Record<string, string> = {
  impressions: "表示回数(28日)",
  clicks: "クリック(28日)",
  ctr: "実CTR",
  position: "平均掲載順位",
  benchmarkCtr: "順位別の目安CTR",
  extraClicks: "取り逃しているクリック数",
  positionBefore: "以前の順位",
  positionAfter: "現在の順位",
  delta: "順位の変化",
  clicksBefore: "以前のクリック",
  clicksAfter: "現在のクリック",
  pages: "競合しているページ数",
  paths: "対象ページ",
};

/**
 * 施策タイプ別の指示書（Markdown）。
 * 「どのページの、どこを、何に変えるか」が曖昧だと反映されないため、
 * 対象URLと作業手順を必ず含める。
 */
export function buildInstruction(ctx: ActionContext): string {
  const url = absoluteUrl(ctx.baseUrl, ctx.targetPage);
  const head = `# 作業依頼: ${TITLES[ctx.actionType] ?? ctx.actionType}\n\n**対象サイト**: ${ctx.siteName}\n**対象ページ**: ${url}${
    ctx.targetQuery ? `\n**対象キーワード**: ${ctx.targetQuery}` : ""
  }`;
  const body = BODY[ctx.actionType]?.(ctx, url) ?? GENERIC(ctx, url);
  return [head, evidenceBlock(ctx.evidence), body, expectedBlock(ctx.expected), FOOTER].join("\n\n");
}

const TITLES: Record<string, string> = {
  title_meta: "タイトル・メタディスクリプションの改善",
  internal_link: "内部リンクの追加",
  merge_pages: "重複ページの統合",
  technical: "技術的な修正",
  cta_form: "CTA・問い合わせフォームの改善",
  rewrite: "既存記事のリライト",
  new_article: "新規記事の作成",
};

const BODY: Record<string, (ctx: ActionContext, url: string) => string> = {
  title_meta: (ctx) => `## 作業内容

1. 対象ページの \`<title>\` を下記の案に差し替えてください（1案を選択、または組み合わせ）
2. \`<meta name="description">\` も併せて見直してください（120〜140文字目安）
3. 反映後、CRMの施策画面で「反映しました」を押してください（効果検証の起点になります）

### タイトル案
> AIが未生成のため、下記の型に沿って作成してください（AIバッチを有効にすると案が自動で入ります）

- 案1（結論型）: 「${ctx.targetQuery}」+ 結論・数字 + 会社名
- 案2（課題型）: 「${ctx.targetQuery}」+ 読者の課題 + 解決策
- 案3（網羅型）: 「${ctx.targetQuery}」+ 「〇選」「完全ガイド」など網羅性の明示

### 守ること
- 対象キーワード「${ctx.targetQuery}」を**タイトルの前半**に入れる
- 全角30文字前後（検索結果で省略されない長さ）
- 誇大表現・実績のない数字は書かない`,

  internal_link: (ctx, url) => `## 作業内容

1. サイト内の関連ページ本文中から、${url} へのリンクを **2〜3本** 追加してください
2. アンカーテキストは「${ctx.targetQuery || "対象ページのテーマ"}」を含む自然な日本語にしてください
3. ナビゲーションやフッターではなく、**本文中の文脈に沿った位置**に置いてください（本文リンクの方が評価されます）
4. 反映後、CRMで「反映しました」を押してください

### 避けること
- 「こちら」「詳細はこちら」だけのアンカーテキスト
- 同一ページからの重複リンク`,

  merge_pages: (ctx) => `## 作業内容

同一キーワード「${ctx.targetQuery}」で自社の複数ページが競合しています。どちらも順位が上がらない状態です。

1. 下記の対象ページのうち **どれを残すか** を決めてください（表示回数・内容の充実度で判断）
2. 残さないページの内容を、残すページに統合してください
3. 統合したページから残すページへ **301リダイレクト** を設定してください
4. サイト内の該当ページへのリンクを、残すページ向けに張り替えてください

**対象**: ${String(ctx.evidence.paths ?? ctx.targetPage)}

### 注意
- 削除だけして放置しないでください（リダイレクトを設定しないと流入を失います）`,

  cta_form: (ctx, url) => `## 作業内容

${url} は流入があるのに問い合わせに繋がっていません。

1. 記事の**冒頭・中間・末尾の3箇所**に、文脈に合うCTAを配置してください
2. 問い合わせフォームの必須項目を **会社名・氏名・メール・相談内容の4つまで** に絞ってください
3. 「問い合わせ」よりハードルの低い導線（資料ダウンロード / 無料相談の予約リンク）を併設してください
4. 反映後、CRMで「反映しました」を押してください`,

  technical: (ctx, url) => `## 作業内容

${url} に技術的な問題が検出されています。

${String(ctx.evidence.detected ?? "")}

1. 上記の指摘箇所を修正してください
2. 反映後、CRMで「反映しました」を押してください`,

  rewrite: (ctx, url) => `## 作業内容（記事パイプラインで実施）

${url} を対象キーワード「${ctx.targetQuery}」向けにリライトします。

1. CRMの「記事ネタ・ブログ」に本施策から起票済みです
2. 構成案 → 本文 → 監修 の順で進めてください
3. 一次情報（自社の実施実績・受講者の声・商談で頻出する質問）を必ず1つ以上入れてください
4. 公開後、CRMで「反映しました」を押してください

### リライトの優先順位
1. 見出し構成を検索意図に合わせる
2. 冒頭200文字で結論を書く
3. 古い情報・陳腐化した記述を差し替える`,

  new_article: (ctx) => `## 作業内容（記事パイプラインで実施）

対象キーワード「${ctx.targetQuery || "未設定"}」向けの新規記事を作成します。

1. CRMの「記事ネタ・ブログ」に本施策から起票済みです
2. 発注検討層に届く記事にしてください（料金の目安・比較軸・導入事例のいずれかを含める）
3. 一次情報を必ず入れてください。汎用的な解説記事では順位が付きません
4. 公開後、CRMで「反映しました」を押してください`,
};

const GENERIC = (ctx: ActionContext, url: string) => `## 作業内容

${url} に対して「${TITLES[ctx.actionType] ?? ctx.actionType}」を実施してください。
反映後、CRMで「反映しました」を押してください。`;

const FOOTER = `---
この指示書はCRMのSEO施策管理から自動生成されています。
**反映が完了したら、必ずCRM側で「反映しました」を記録してください。**
記録した日を起点に14日後、効果を自動で判定します（記録が無いと効果を測れません）。`;
