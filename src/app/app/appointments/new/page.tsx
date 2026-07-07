import { getSupabaseServer } from "@/lib/supabase/server";
import { requireCtx } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { AppointmentRegisterForm } from "@/components/appointments/appointment-register-form";

export const dynamic = "force-dynamic";

/** インサイドセールス向け: アポ獲得をその場で登録(顧客検索/新規→担当→日時→案件化)。 */
export default async function NewAppointmentPage() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const [ownersR, productsR, sourcesR, detailsR, bookingR] = await Promise.all([
    sb.from("profiles").select("id,display_name,email"),
    sb.from("products").select("id,name").eq("status", "active"),
    sb.from("lead_sources").select("id,name"),
    sb.from("lead_source_details").select("id, lead_source_id, name").eq("status", "active").order("name"),
    sb.from("booking_links").select("id,label,url,sort_order").order("sort_order"),
  ]);
  const owners = (ownersR.data ?? []).map((p) => ({ id: p.id as string, name: (p.display_name as string) ?? (p.email as string) ?? "—" }));
  const products = (productsR.data ?? []).map((p) => ({ id: p.id as string, name: (p.name as string) ?? "—" }));
  const sources = (sourcesR.data ?? []).map((s) => ({ id: s.id as string, name: (s.name as string) ?? "—" }));
  const details = (detailsR.data ?? []).map((d) => ({ id: d.id as string, lead_source_id: d.lead_source_id as string, name: d.name as string }));
  const bookingLinks = (bookingR.data ?? []).map((b) => ({ id: b.id as string, label: b.label as string, url: b.url as string }));

  return (
    <div>
      <PageHeader
        title="アポ登録"
        subtitle="リード（展示会リスト）・既存顧客・新規のいずれからでも登録。リード起点は詳細情報が案件に自動コピーされ、リードはアポ決着に更新されます。"
      />
      <AppointmentRegisterForm owners={owners} products={products} sources={sources} details={details} bookingLinks={bookingLinks} currentUserId={ctx.userId} />
    </div>
  );
}
