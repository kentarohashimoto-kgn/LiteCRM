import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { QuickLogForm } from "@/components/today/quick-log-form";
import { ClearNextActionButton } from "@/components/today/clear-next-action-button";
import { BulkClearStale } from "@/components/today/bulk-clear-stale";
import { HotLeadsSection } from "@/components/today/hot-leads";
import { formatYen } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface TodayOpp {
  id: string;
  name: string;
  yomi: string | null;
  amount: number;
  account_id: string | null;
  appointment_at: string | null;
  first_meeting_date: string | null;
  next_action_date: string | null;
  next_action_text: string | null;
  updated_at: string;
  accounts: { name: string } | null;
}

function jstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function jstTime(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(11, 16);
}

/**
 * A-7 モバイル入力動線: 「今日のアポ → 終わったらその場で活動登録」のスマホ特化ビュー。
 * 自分担当のオープン案件のうち、今日のアポ / 今日の次回AC / 期限超過を1画面に。
 */
export default async function TodayPage(props: { searchParams: Promise<{ all?: string; saved?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const showAll = searchParams.all === "1";
  const today = jstDate(new Date().toISOString());

  let q = sb
    .from("opportunities")
    .select("id, name, yomi, amount, account_id, appointment_at, first_meeting_date, next_action_date, next_action_text, updated_at, accounts(name)")
    .eq("status", "open")
    .or(`appointment_at.not.is.null,next_action_date.lte.${today},first_meeting_date.eq.${today}`)
    .limit(300);
  if (!showAll) q = q.eq("owner_user_id", ctx.userId);
  const { data } = await q;
  const rows = (data ?? []) as unknown as TodayOpp[];

  const appts = rows
    .filter((o) => {
      const day = o.appointment_at ? jstDate(o.appointment_at) : o.first_meeting_date;
      return day === today;
    })
    .sort((a, b) => (a.appointment_at ?? "").localeCompare(b.appointment_at ?? ""));
  const apptIds = new Set(appts.map((o) => o.id));
  const acsToday = rows.filter((o) => !apptIds.has(o.id) && o.next_action_date === today);
  const overdue = rows
    .filter((o) => !apptIds.has(o.id) && o.next_action_date && o.next_action_date < today)
    .sort((a, b) => (a.next_action_date ?? "").localeCompare(b.next_action_date ?? ""))
    .slice(0, 30);

  // clearable: 次回ACが理由でこのリストに載っている行だけ「消込」を出す。
  // 今日のアポ枠はアポが理由で載っているので、そこにACの消込を並べると意味が混ざる。
  const Item = ({ o, badge, clearable }: { o: TodayOpp; badge?: string; clearable?: boolean }) => (
    <li className="card card-pad">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {o.appointment_at && jstDate(o.appointment_at) === today && (
              <span className="pill bg-teal-light text-teal-deep font-semibold">{jstTime(o.appointment_at)}</span>
            )}
            {badge && <span className="pill bg-rose-50 text-rose-600">{badge}</span>}
            <Link href={`/app/opportunities/${o.id}`} className="text-sm font-semibold text-ink hover:text-teal-deep min-w-0 truncate">
              {o.accounts?.name ? `${o.accounts.name}｜` : ""}{o.name}
            </Link>
          </div>
          <div className="text-xs text-ink/45 mt-1">
            {o.yomi ?? "—"} ・ {formatYen(o.amount)}
            {o.next_action_text ? ` ・ AC: ${o.next_action_text.slice(0, 40)}` : ""}
          </div>
        </div>
        <Link href={`/app/opportunities/${o.id}`} className="text-ink/25 shrink-0 mt-0.5"><ChevronRight size={18} /></Link>
      </div>
      <QuickLogForm opportunityId={o.id} accountId={o.account_id} />
      {clearable && (
        <div className="flex justify-end">
          <ClearNextActionButton opportunityId={o.id} updatedAt={o.updated_at} nextActionDate={o.next_action_date} />
        </div>
      )}
    </li>
  );

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="今日のアポ・AC"
        subtitle="商談が終わったら、その場で活動を記録しましょう。"
        action={
          <Link
            href={showAll ? "/app/today" : "/app/today?all=1"}
            className="rounded-xl border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
          >
            {showAll ? "自分の担当のみ" : "チーム全体を見る"}
          </Link>
        }
      />
      {searchParams.saved === "activity" && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">✓ 活動を記録しました</div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card><div className="text-xs text-ink/50">今日のアポ</div><div className="stat-value mt-1">{appts.length}</div></Card>
        <Card><div className="text-xs text-ink/50">今日のAC</div><div className="stat-value mt-1">{acsToday.length}</div></Card>
        <Card><div className="text-xs text-ink/50">期限超過</div><div className={`stat-value mt-1 ${overdue.length > 0 ? "text-rose-600" : ""}`}>{overdue.length}</div></Card>
      </div>

      <div className="mb-5">
        <HotLeadsSection />
      </div>

      <Section title={`今日のアポ（${appts.length}）`} className="mb-5">
        {appts.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center flex items-center justify-center gap-1.5"><CalendarClock size={15} /> 今日のアポはありません</p>
        ) : (
          <ul className="space-y-3">{appts.map((o) => <Item key={o.id} o={o} />)}</ul>
        )}
      </Section>

      <Section title={`今日の次回アクション（${acsToday.length}）`} className="mb-5">
        {acsToday.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">今日が期限の次回ACはありません</p>
        ) : (
          <ul className="space-y-3">{acsToday.map((o) => <Item key={o.id} o={o} clearable />)}</ul>
        )}
      </Section>

      <Section title={`期限超過（${overdue.length}）`} action={<BulkClearStale teamWide={showAll} />}>
        {overdue.length === 0 ? (
          <p className="text-sm text-ink/40 py-4 text-center">超過している次回ACはありません 🎉</p>
        ) : (
          <ul className="space-y-3">{overdue.map((o) => <Item key={o.id} o={o} badge={`${o.next_action_date} 超過`} clearable />)}</ul>
        )}
      </Section>
    </div>
  );
}
