/** アポカレンダーのイベント型。RPC appointment_calendar_events の1要素。 */
export interface CalItem {
  kind: "appt" | "done";        // アポ(予定) / アポ済(実施)
  opportunity_id: string;
  meeting_id: string | null;    // 商談レコード由来ならそのID
  account_name: string | null;
  opp_name: string | null;
  yomi: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  at: string | null;            // ISO datetime(時刻あり) or null
  on_date: string;              // YYYY-MM-DD(JST基準の日)
  timed: boolean;
  title: string;                // アポ / 初回商談 / 商談 / 2回目 等
  meeting_count: number;
}
