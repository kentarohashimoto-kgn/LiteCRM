import { Upload } from "lucide-react";
import { getWorkspace } from "@/lib/data/workspace";
import { listLeads } from "@/lib/data/select";
import { PageHeader, LinkButton } from "@/components/ui/primitives";
import { LeadsWorkspace, type LeadRow } from "@/components/leads/leads-workspace";

export default async function LeadsPage() {
  const ws = await getWorkspace();
  const leads = listLeads(ws);

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    company: l.company_name ?? "",
    companyNorm: l.company_norm ?? l.company_name ?? "",
    name: l.contact_name ?? "",
    email: l.email ?? "",
    phone: l.phone ?? "",
    jobTitle: l.job_title ?? "",
    empSize: l.employee_size ?? "",
    industry: l.industry ?? "",
    pref: l.prefecture ?? "",
    rank: l.rank ?? "",
    disposition: l.disposition ?? "untouched",
    score: l.priority_score ?? 0,
    callOwner: l.call_owner ?? "",
    event: l.raw_event ?? "",
    dealOwner: l.deal_owner_name ?? "",
    tags: l.tags ?? "",
  }));

  return (
    <div>
      <PageHeader
        title="リード"
        subtitle="展示会・セミナーのリストを優先度付けし、架電→アポ獲得まで管理・分析します。"
        action={<LinkButton href="/app/leads/import" variant="accent"><Upload size={16} /> 取込</LinkButton>}
      />
      <LeadsWorkspace rows={rows} />
    </div>
  );
}
