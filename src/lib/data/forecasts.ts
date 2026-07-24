/** 原価管理: デリバリー見込み(継続/延長・新規受注見込み)の取得と、月次ロールアップ・採用/契約アラートの算出。 */
import { getSupabaseServer } from "@/lib/supabase/server";
import { monthKey, monthRange } from "@/lib/data/projects";

export type ForecastKind = "continuation" | "new";
export type StaffingStatus = "ready" | "shortage" | "unknown";
export type AmountBasis = "monthly" | "total";

export interface ForecastRow {
  id: string;
  kind: ForecastKind;
  title: string;
  startMonth: string | null; // YYYY-MM
  endMonth: string | null;
  amount: number; // 入力値
  amountBasis: AmountBasis;
  monthlyAmount: number; // 月額換算
  totalAmount: number; // 総額換算
  probability: number; // 0..100
  requiredHeadcount: number; // 同時稼働の必要人数
  staffingStatus: StaffingStatus;
  arrangeDeadline: string | null; // YYYY-MM-DD
  notes: string | null;
  months: string[]; // 実施(見込み)月 YYYY-MM
}

export interface ForecastMonth {
  month: string; // YYYY-MM
  weightedAmount: number; // Σ 月額 × 確度
  rawAmount: number; // Σ 月額
  requiredHeadcount: number; // 同月に必要な人数(見込み合計)
  shortageHeadcount: number; // うち要手配
}

export interface ForecastAlerts {
  next6Weighted: number; // 今後6ヶ月の確度加重見込み
  next6Raw: number; // 今後6ヶ月の素の見込み
  shortageHeadcountNext3: number; // 今後3ヶ月で要手配の必要人数合計
  actionItems: ForecastRow[]; // 期限接近/開始間近で手配が未完のもの
}

export interface ForecastData {
  rows: ForecastRow[];
  months: ForecastMonth[]; // 今月から12ヶ月
  nowMonth: string;
  alerts: ForecastAlerts;
}

const TENANT = "00000000-0000-0000-0000-000000000001";

/** "YYYY-MM" に n ヶ月足す。 */
export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const idx = (y * 12 + (mo - 1)) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

interface ForecastDbRow {
  id: string; kind: string; title: string;
  start_month: string | null; end_month: string | null;
  amount: number | null; amount_basis: string; probability: number | null;
  required_headcount: number | null; staffing_status: string;
  arrange_deadline: string | null; notes: string | null;
}

/** デリバリー見込みを取得し、月次ロールアップとアラートを算出する。 */
export async function listDeliveryForecasts(): Promise<ForecastData> {
  const sb = getSupabaseServer();
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD(JST)
  const nowMonth = todayIso.slice(0, 7);

  const { data, error } = await sb
    .from("delivery_forecasts")
    .select("id, kind, title, start_month, end_month, amount, amount_basis, probability, required_headcount, staffing_status, arrange_deadline, notes")
    .eq("tenant_id", TENANT)
    .eq("status", "active")
    .order("start_month", { ascending: true });
  if (error) throw new Error(`デリバリー見込みの取得に失敗: ${error.message}`);

  const rows: ForecastRow[] = ((data ?? []) as ForecastDbRow[]).map((r) => {
    const startMonth = r.start_month ? monthKey(r.start_month) : null;
    const endMonth = r.end_month ? monthKey(r.end_month) : null;
    const months = startMonth && endMonth ? monthRange(r.start_month, r.end_month) : startMonth ? [startMonth] : [];
    const amount = Number(r.amount) || 0;
    const basis = (r.amount_basis === "total" ? "total" : "monthly") as AmountBasis;
    const n = Math.max(1, months.length);
    const monthlyAmount = basis === "monthly" ? amount : amount / n;
    const totalAmount = basis === "monthly" ? amount * months.length : amount;
    return {
      id: r.id,
      kind: (r.kind === "new" ? "new" : "continuation") as ForecastKind,
      title: r.title,
      startMonth, endMonth, amount, amountBasis: basis,
      monthlyAmount, totalAmount,
      probability: r.probability ?? 50,
      requiredHeadcount: Number(r.required_headcount) || 0,
      staffingStatus: (["ready", "shortage", "unknown"].includes(r.staffing_status) ? r.staffing_status : "unknown") as StaffingStatus,
      arrangeDeadline: r.arrange_deadline,
      notes: r.notes,
      months,
    };
  });

  // 今月から12ヶ月のロールアップ
  const windowMonths: string[] = Array.from({ length: 12 }, (_, i) => addMonths(nowMonth, i));
  const inWindow = new Set(windowMonths);
  const acc = new Map<string, ForecastMonth>(windowMonths.map((m) => [m, { month: m, weightedAmount: 0, rawAmount: 0, requiredHeadcount: 0, shortageHeadcount: 0 }]));
  for (const f of rows) {
    for (const m of f.months) {
      if (!inWindow.has(m)) continue;
      const cell = acc.get(m)!;
      cell.rawAmount += f.monthlyAmount;
      cell.weightedAmount += (f.monthlyAmount * f.probability) / 100;
      cell.requiredHeadcount += f.requiredHeadcount;
      if (f.staffingStatus === "shortage") cell.shortageHeadcount += f.requiredHeadcount;
    }
  }
  const monthsRollup = windowMonths.map((m) => acc.get(m)!);

  // アラート
  const next6 = new Set(Array.from({ length: 6 }, (_, i) => addMonths(nowMonth, i)));
  const next3 = new Set(Array.from({ length: 3 }, (_, i) => addMonths(nowMonth, i)));
  let next6Weighted = 0, next6Raw = 0, shortageHeadcountNext3 = 0;
  for (const f of rows) {
    for (const m of f.months) {
      if (next6.has(m)) { next6Raw += f.monthlyAmount; next6Weighted += (f.monthlyAmount * f.probability) / 100; }
    }
    if (f.staffingStatus === "shortage" && f.months.some((m) => next3.has(m))) shortageHeadcountNext3 += f.requiredHeadcount;
  }

  // 手配が未完(要手配/未定)で、調整期限が45日以内 or 開始が2ヶ月以内 のもの
  const deadlineLimit = new Date(todayIso); deadlineLimit.setDate(deadlineLimit.getDate() + 45);
  const startLimit = addMonths(nowMonth, 2);
  const actionItems = rows
    .filter((f) => f.staffingStatus !== "ready")
    .filter((f) => (f.arrangeDeadline != null && f.arrangeDeadline <= deadlineLimit.toISOString().slice(0, 10)) || (f.startMonth != null && f.startMonth <= startLimit))
    .sort((a, b) => {
      const ak = a.arrangeDeadline ?? (a.startMonth ? `${a.startMonth}-01` : "9999-12-31");
      const bk = b.arrangeDeadline ?? (b.startMonth ? `${b.startMonth}-01` : "9999-12-31");
      return ak.localeCompare(bk);
    });

  return {
    rows,
    months: monthsRollup,
    nowMonth,
    alerts: { next6Weighted, next6Raw, shortageHeadcountNext3, actionItems },
  };
}
