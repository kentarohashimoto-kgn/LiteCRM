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
}

export interface AccountsPage {
  rows: AccountPageRow[];
  total: number;
}

export interface AccountPageFilter {
  q?: string;
  rank?: string;
  focus?: string;
  area?: string;
  industry?: string;
  owner?: string;
  active?: string;
}
