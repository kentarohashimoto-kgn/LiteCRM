/**
 * Sランク顧客(エンタープライズ攻略)のマスタとヘルパー。
 * 会社単位の攻略ステージ・部署提案状況・キーマン役割などの表示定義。
 */

export const SRANK_STAGES: { key: string; label: string; desc: string }[] = [
  { key: "S-01", label: "重点候補", desc: "Sランク候補として認識、攻略計画はまだ" },
  { key: "S-02", label: "初回接点あり", desc: "1部署または1名と接点" },
  { key: "S-03", label: "部署課題把握", desc: "具体的な部署課題を把握" },
  { key: "S-04", label: "初回提案中", desc: "研修・顧問・PoCなどを提案中" },
  { key: "S-05", label: "初回受注", desc: "1部署で受注済み" },
  { key: "S-06", label: "成果確認中", desc: "初回取引の成果を確認" },
  { key: "S-07", label: "横展開準備", desc: "他部署展開・上位者報告・追加提案を準備" },
  { key: "S-08", label: "複数部署商談中", desc: "2部署以上で商談進行" },
  { key: "S-09", label: "経営層接点あり", desc: "役員・部長クラスと接点" },
  { key: "S-10", label: "全社提案中", desc: "全社研修・AI顧問・ロードマップ提案中" },
  { key: "S-11", label: "重点取引先化", desc: "複数部署で継続取引" },
  { key: "S-12", label: "戦略顧客化", desc: "年間1,000万円以上の継続取引先" },
];
export const SRANK_STAGE_MAP = Object.fromEntries(SRANK_STAGES.map((s) => [s.key, s]));

export const DEAL_STATUS: { key: string; label: string }[] = [
  { key: "none", label: "未取引" },
  { key: "in_progress", label: "商談中" },
  { key: "active", label: "取引あり" },
  { key: "dormant", label: "休眠" },
];
export const DEAL_STATUS_LABEL: Record<string, string> = Object.fromEntries(DEAL_STATUS.map((d) => [d.key, d.label]));

export const PROPOSAL_STATUS: { key: string; label: string }[] = [
  { key: "none", label: "未提案" },
  { key: "preparing", label: "提案準備中" },
  { key: "proposed", label: "提案済" },
  { key: "reviewing", label: "検討中" },
  { key: "won", label: "受注" },
  { key: "lost", label: "失注" },
];
export const PROPOSAL_STATUS_LABEL: Record<string, string> = Object.fromEntries(PROPOSAL_STATUS.map((p) => [p.key, p.label]));

export const KEYPERSON_ROLES: { key: string; label: string }[] = [
  { key: "decision", label: "決裁者" },
  { key: "promoter", label: "推進者" },
  { key: "field", label: "現場担当" },
  { key: "introducer", label: "紹介者" },
  { key: "opponent", label: "反対者" },
  { key: "info", label: "情報収集者" },
];
export const KEYPERSON_ROLE_LABEL: Record<string, string> = Object.fromEntries(KEYPERSON_ROLES.map((r) => [r.key, r.label]));

export const LEVEL3: { key: string; label: string }[] = [
  { key: "high", label: "高" },
  { key: "mid", label: "中" },
  { key: "low", label: "低" },
];
export const RELATIONSHIP: { key: string; label: string }[] = [
  { key: "strong", label: "強い" },
  { key: "normal", label: "普通" },
  { key: "weak", label: "弱い" },
  { key: "none", label: "未接触" },
];

/** トップダウン提案メニュー候補。 */
export const TOPDOWN_MENU = [
  "経営層向けAI活用勉強会", "役員向けAI活用ブリーフィング", "管理職向け生成AI研修",
  "全社AI活用ロードマップ策定", "部門横断AI活用ワークショップ", "AI活用推進プロジェクト",
  "AI顧問契約", "全社AI人材育成計画", "グループ会社展開プラン",
];
/** ボトムアップ(部署別)提案メニュー候補。 */
export const BOTTOMUP_MENU = [
  "営業部門向けAI活用研修", "経理・人事・総務向けAI活用研修", "情シス・DX部門向けAI活用研修",
  "開発部門向けClaude Code / Copilot研修", "社内FAQ/RAG構築", "AI-OCR", "議事録AI",
  "問い合わせ対応AI", "営業資料作成AI", "業務棚卸しワークショップ", "部門別PoC",
];
