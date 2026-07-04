/** お土産ソリューション(カタログ・顧客別候補)のデータ取得。RLS準拠。 */
import { getSupabaseServer } from "@/lib/supabase/server";

export interface SolutionPackage {
  id: string;
  package_name: string;
  package_category: string;
  customer_benefit: string;
  proposal_timing: string | null;
  next_expansion: string | null;
  target_customer: string | null;
}

export interface AccountSouvenir {
  id: string;
  package_id: string;
  package_name: string;
  status: string;
  customer_reaction: string | null;
  note: string | null;
}

export const SOUVENIR_STATUS: { key: string; label: string }[] = [
  { key: "candidate", label: "候補" },
  { key: "presented", label: "提示済" },
  { key: "proposed", label: "提案する" },
  { key: "declined", label: "見送り" },
];
export const SOUVENIR_STATUS_LABEL = Object.fromEntries(SOUVENIR_STATUS.map((s) => [s.key, s.label]));

export async function getSolutionPackages(): Promise<SolutionPackage[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("solution_packages")
    .select("id,package_name,package_category,customer_benefit,proposal_timing,next_expansion,target_customer")
    .eq("is_active", true)
    .order("created_at");
  return (data ?? []) as SolutionPackage[];
}

export async function getAccountSouvenirs(accountId: string): Promise<AccountSouvenir[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("account_souvenirs")
    .select("id,package_id,status,customer_reaction,note,solution_packages(package_name)")
    .eq("account_id", accountId)
    .order("created_at");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    package_id: r.package_id as string,
    package_name: ((r.solution_packages as { package_name?: string } | null)?.package_name) ?? "—",
    status: r.status as string,
    customer_reaction: (r.customer_reaction as string) ?? null,
    note: (r.note as string) ?? null,
  }));
}
