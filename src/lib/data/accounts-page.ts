/** 顧客一覧のサーバーページング用の型。 */
export interface AccountPageRow {
  id: string;
  name: string;
  industry: string | null;
  area: string | null;
  status: string;
  rank: string | null;
  focus: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  lifetime_revenue: number;
  open_amount: number;
  opp_count: number;
  is_active: boolean;
  // エンゲージメント(会社ロールアップ。0013/0193)。接点なしは null
  engagement_score: number | null;
  engagement_rank: string | null;
}

export interface AccountsPage {
  rows: AccountPageRow[];
  total: number;
}

export interface AccountPageFilter {
  q?: string;
  // rank / focus / area / industry / owner は複数選択(OR)。単一文字列も後方互換で可。
  rank?: string[] | string;
  focus?: string[] | string;
  area?: string[] | string;
  industry?: string[] | string;
  owner?: string[] | string;
  active?: string;
  // エンゲージメント: ランク(S〜D。Dは接点なしも含む)と合計点の下限
  engRank?: string[] | string;
  engMin?: string;
}
