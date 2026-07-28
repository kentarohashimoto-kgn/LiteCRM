import Link from "next/link";
import { Flame, Phone } from "lucide-react";
import { getSupabaseServer } from "@/lib/supabase/server";
import { GRADE_DEFS, MAIL_TOUCH_LABEL, type PriorityGrade } from "@/lib/engagement";
import { Section, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * 🔥 反応のあったリード(F-205 MVP)。直近48時間にメール反応(開封/クリック/資料閲覧/返信)が
 * あったリードを、その理由つきで一覧表示する。通知(アプリ内/Chat DM)の受け皿となる常設ビュー。
 */

const GRADE_COLOR: Record<string, string> = {
  P1: "bg-rose-100 text-rose-700",
  P2: "bg-amber-100 text-amber-700",
  P3: "bg-teal-light text-teal-deep",
  P4: "bg-mist-soft text-ink/60",
  P5: "bg-mist-soft text-ink/40",
};

function jstTimeLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.toISOString().slice(5, 10).replace("-", "/")} ${d.toISOString().slice(11, 16)}`;
}

export async function HotLeadsSection() {
  const sb = getSupabaseServer();
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("leads")
    .select("id, company_name, contact_name, rank, priority_grade, last_engaged_at, email, phone, mobile_phone, raw_event")
    .gte("last_engaged_at", since)
    .order("last_engaged_at", { ascending: false })
    .limit(15);
  const rows = data ?? [];
  if (rows.length === 0) return null;

  // 反応内容(理由)をエンゲージメント集計から引く
  const emails = [...new Set(rows.map((l) => (l.email as string | null)?.toLowerCase()).filter(Boolean) as string[])];
  const engMap = new Map<string, { score: number; types: string[] }>();
  if (emails.length) {
    const { data: eng } = await sb.from("person_engagement").select("email, score, types").in("email", emails);
    for (const e of eng ?? []) engMap.set(String(e.email).toLowerCase(), { score: e.score ?? 0, types: (e.types as string[]) ?? [] });
  }

  return (
    <Section title="反応のあったリード（48時間以内）" icon={<Flame size={16} className="text-rose-500" />}>
      <div className="space-y-2">
        {rows.map((l) => {
          const eng = engMap.get((l.email as string | null)?.toLowerCase() ?? "");
          const mailTypes = (eng?.types ?? []).filter((t) => t in MAIL_TOUCH_LABEL).map((t) => MAIL_TOUCH_LABEL[t]);
          const grade = (l.priority_grade as PriorityGrade | null) ?? null;
          const tel = (l.phone as string) || (l.mobile_phone as string) || "";
          return (
            <Card key={l.id as string} className="!p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {grade && <span className={cn("pill text-[10px]", GRADE_COLOR[grade])} title={GRADE_DEFS[grade].action}>{GRADE_DEFS[grade].label}</span>}
                    <Link href={`/app/leads/${l.id}`} className="font-medium text-ink hover:text-teal-deep truncate">
                      {(l.company_name as string) || "(会社名なし)"}
                    </Link>
                    <span className="text-xs text-ink/50 truncate">{(l.contact_name as string) ?? ""}</span>
                  </div>
                  <p className="text-xs text-ink/55 mt-0.5">
                    {jstTimeLabel(l.last_engaged_at as string)}
                    {mailTypes.length > 0 && <> ・ {mailTypes.join("・")}{eng ? `（${eng.score}pt）` : ""}</>}
                    {l.rank && <> ・ Fit {l.rank as string}</>}
                    {grade && <span className="text-rose-600 font-medium"> → {GRADE_DEFS[grade].action}</span>}
                  </p>
                </div>
                {tel && (
                  <a href={`tel:${tel.replace(/[^0-9+]/g, "")}`} className="btn-ghost inline-flex items-center gap-1 text-xs shrink-0">
                    <Phone size={13} /> 発信
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
