"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { promoteLeadToOpportunityAction } from "@/server/actions";

export function PromoteLeadButton({ leadId, size = "full" }: { leadId: string; size?: "full" | "mini" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    const res = await promoteLeadToOpportunityAction(leadId);
    if (res.ok && res.opportunityId) {
      router.push(`/app/opportunities/${res.opportunityId}`);
    } else {
      router.refresh();
      setBusy(false);
    }
  }

  if (size === "mini") {
    return (
      <button onClick={run} disabled={busy} title="案件化(商談を作成)" className="inline-flex items-center gap-1 text-xs text-teal-deep hover:text-teal-primary disabled:opacity-40">
        <ArrowUpRight size={13} /> {busy ? "…" : "案件化"}
      </button>
    );
  }
  return (
    <button onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 btn-accent disabled:opacity-40">
      <ArrowUpRight size={16} /> {busy ? "案件化中…" : "案件化（商談を作成）"}
    </button>
  );
}
