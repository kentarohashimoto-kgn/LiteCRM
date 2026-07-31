/**
 * メール送信履歴の宛先解決(サーバー専用)。
 * メール(email_messages)自体は会社名・担当者名を持たないため、
 * 紐づくリード(lead_id) → 取引先担当者(contact_id) → 顧客(account_id) の順に解決する。
 * 送信履歴の一覧/詳細/CSVダウンロードで共有する。
 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface MailRecipient {
  company: string;
  contact: string;
  /** リードの流入元(raw_event)。リード紐づけが無ければ空 */
  event: string;
  leadId: string | null;
  accountId: string | null;
}

interface MsgRef {
  id: string;
  lead_id?: string | null;
  contact_id?: string | null;
  account_id?: string | null;
}

/** email_messages.id → 宛先(会社名・担当者名・リンク先)。id集合ごとの一括取得で解決する。 */
export async function resolveMailRecipients(msgs: MsgRef[]): Promise<Map<string, MailRecipient>> {
  const sb = getSupabaseServer();
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
  const chunked = async <T,>(ids: string[], fn: (slice: string[]) => Promise<T[]>): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...(await fn(ids.slice(i, i + 500))));
    return out;
  };

  const leadMap = new Map<string, { company: string; contact: string; event: string }>();
  await chunked(uniq(msgs.map((m) => m.lead_id)), async (s) => {
    const { data } = await sb.from("leads").select("id, company_name, contact_name, raw_event").in("id", s);
    for (const l of data ?? []) leadMap.set(l.id as string, {
      company: (l.company_name as string) ?? "", contact: (l.contact_name as string) ?? "", event: (l.raw_event as string) ?? "",
    });
    return data ?? [];
  });

  const contactMap = new Map<string, { name: string; accountId: string | null }>();
  await chunked(uniq(msgs.map((m) => m.contact_id)), async (s) => {
    const { data } = await sb.from("contacts").select("id, name, account_id").in("id", s);
    for (const c of data ?? []) contactMap.set(c.id as string, { name: (c.name as string) ?? "", accountId: (c.account_id as string) ?? null });
    return data ?? [];
  });

  // 取引先担当者経由で判明する顧客IDも会社名の解決対象に含める
  const allAccountIds = uniq([...msgs.map((m) => m.account_id), ...[...contactMap.values()].map((c) => c.accountId)]);
  const accountMap = new Map<string, string>();
  await chunked(allAccountIds, async (s) => {
    const { data } = await sb.from("accounts").select("id, name").in("id", s);
    for (const a of data ?? []) accountMap.set(a.id as string, (a.name as string) ?? "");
    return data ?? [];
  });

  const out = new Map<string, MailRecipient>();
  for (const m of msgs) {
    const lead = m.lead_id ? leadMap.get(m.lead_id) : undefined;
    const contact = m.contact_id ? contactMap.get(m.contact_id) : undefined;
    const accId = (m.account_id ?? null) || (contact?.accountId ?? null);
    out.set(m.id, {
      company: lead?.company || (accId ? accountMap.get(accId) ?? "" : ""),
      contact: lead?.contact || contact?.name || "",
      event: lead?.event ?? "",
      leadId: m.lead_id ?? null,
      accountId: accId,
    });
  }
  return out;
}
