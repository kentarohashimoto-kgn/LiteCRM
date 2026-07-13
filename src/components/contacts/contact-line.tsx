import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  decision_maker: "意思決定者",
  influencer: "影響者",
  user: "利用者",
  referrer: "紹介者",
};

/**
 * 顧客側担当者の1行表示(氏名+部署・役職)。
 * isAccounter=true でこの案件のアカウンター(窓口)として強調表示する。
 */
export function ContactLine({ c, isAccounter, showEmail }: { c: Contact; isAccounter?: boolean; showEmail?: boolean }) {
  return (
    <div className={cn("text-sm", isAccounter && "rounded-lg bg-teal-light/40 border border-teal-primary/20 px-2.5 py-2")}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {isAccounter && <span className="pill bg-teal-primary text-white text-[10px] font-bold">アカウンター</span>}
        <span className={cn("font-medium", isAccounter && "text-teal-deep")}>{c.name}</span>
        {c.decision_role && ROLE_LABEL[c.decision_role] && (
          <span className="pill bg-black/[0.05] text-ink/55 text-[10px]">{ROLE_LABEL[c.decision_role]}</span>
        )}
      </div>
      <div className="text-xs text-ink/55 mt-0.5">
        {[c.department, c.title].filter(Boolean).join("・") || <span className="text-ink/35">部署・役職 未登録</span>}
        {showEmail && c.email ? <span className="text-ink/40"> ・ {c.email}</span> : null}
      </div>
    </div>
  );
}
