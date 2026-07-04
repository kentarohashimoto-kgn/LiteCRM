"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  logActivityAction,
  searchAccountsAction,
  searchOpportunitiesAction,
  type PickOption,
} from "@/server/actions/activities";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const PURPOSES = [
  { key: "issue_discovery", label: "課題ヒアリング" },
  { key: "proposal", label: "提案" },
  { key: "budget_check", label: "予算確認" },
  { key: "decision_maker_check", label: "決裁者確認" },
  { key: "follow_up", label: "フォロー" },
  { key: "upsell", label: "アップセル" },
  { key: "relationship", label: "関係構築" },
  { key: "other", label: "その他" },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 顧客/案件のインクリメンタル検索セレクト（上位20件）。 */
function SearchSelect({
  label,
  required,
  placeholder,
  search,
  value,
  onPick,
  disabled,
}: {
  label: string;
  required?: boolean;
  placeholder: string;
  search: (q: string) => Promise<PickOption[]>;
  value: PickOption | null;
  onPick: (o: PickOption | null) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<PickOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setOpts(await search(q)), 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open, search]);

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-ink/60 mb-1">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-mist-soft/40 px-3 py-2 text-sm">
          <span className="flex-1 truncate">{value.label}{value.sub && <span className="text-ink/40 ml-1">{value.sub}</span>}</span>
          {!disabled && <button type="button" onClick={() => onPick(null)} className="text-xs text-ink/40 hover:text-rose-500">変更</button>}
        </div>
      ) : (
        <>
          <input
            value={q}
            disabled={disabled}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            className="input"
          />
          {open && opts.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-black/10 bg-white shadow-lg">
              {opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onPick(o); setOpen(false); setQ(""); }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-mist-soft"
                >
                  {o.label}{o.sub && <span className="text-ink/40 ml-1 text-xs">{o.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink/60 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function ActivityForm({ defaultAccount, defaultOpp }: { defaultAccount?: PickOption; defaultOpp?: PickOption }) {
  const router = useRouter();
  const [account, setAccount] = useState<PickOption | null>(defaultAccount ?? null);
  const [opp, setOpp] = useState<PickOption | null>(defaultOpp ?? null);
  const [saving, setSaving] = useState(false);

  const [activityDate, setActivityDate] = useState(todayStr());
  const [activityType, setActivityType] = useState("meeting");
  const [purpose, setPurpose] = useState("");
  const [content, setContent] = useState("");
  const [reaction, setReaction] = useState("");
  const [issues, setIssues] = useState("");
  const [upsell, setUpsell] = useState("");
  const [budget, setBudget] = useState("");
  const [decision, setDecision] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextText, setNextText] = useState("");
  const [minutesUrl, setMinutesUrl] = useState("");

  const oppSearch = (q: string) => searchOpportunitiesAction(q, account?.id);

  async function submit() {
    if (!account) return alert("顧客を選択してください");
    setSaving(true);
    const res = await logActivityAction({
      accountId: account.id,
      opportunityId: opp?.id ?? null,
      activityDate,
      activityType,
      purpose: purpose || null,
      content,
      customerReaction: reaction || null,
      discoveredIssues: issues || null,
      upsellOpportunity: upsell || null,
      budgetCheckResult: budget || null,
      decisionMakerCheckResult: decision || null,
      nextActionDate: nextDate,
      nextActionText: nextText,
      meetingMinutesUrl: minutesUrl || null,
    });
    setSaving(false);
    if (res.ok) {
      router.push(opp ? `/app/opportunities/${opp.id}` : "/app/activities");
      router.refresh();
    } else {
      alert(res.error);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card card-pad space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SearchSelect label="顧客" required placeholder="会社名で検索" search={searchAccountsAction} value={account} onPick={(o) => { setAccount(o); setOpp(null); }} />
          <SearchSelect label="案件（任意）" placeholder={account ? "案件名で検索" : "先に顧客を選択"} search={oppSearch} value={opp} onPick={setOpp} disabled={!account} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="活動日">
            <input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} className="input" />
          </Field>
          <Field label="活動種別">
            <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="input">
              {ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="活動目的">
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="input">
              <option value="">—</option>
              {PURPOSES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="活動内容 *">
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="何を話したか・状況" className="input" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="顧客反応"><textarea value={reaction} onChange={(e) => setReaction(e.target.value)} rows={2} className="input" /></Field>
          <Field label="発掘課題"><textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} className="input" /></Field>
          <Field label="提案余地（アップセル）"><textarea value={upsell} onChange={(e) => setUpsell(e.target.value)} rows={2} className="input" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="予算確認"><input value={budget} onChange={(e) => setBudget(e.target.value)} className="input" /></Field>
            <Field label="決裁者確認"><input value={decision} onChange={(e) => setDecision(e.target.value)} className="input" /></Field>
          </div>
        </div>
      </div>

      <div className="card card-pad space-y-4 border-teal-primary/30">
        <div className="text-xs font-bold text-teal-deep">次回アクション（必須）</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="次回AC日 *"><input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="input" /></Field>
          <div className="sm:col-span-2">
            <Field label="次回AC内容 *"><input value={nextText} onChange={(e) => setNextText(e.target.value)} placeholder="次に誰が何をするか" className="input" /></Field>
          </div>
        </div>
        <Field label="議事録URL"><input value={minutesUrl} onChange={(e) => setMinutesUrl(e.target.value)} placeholder="tl;dv / Google Drive 等" className="input" /></Field>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={submit} disabled={saving} className={cn("btn-accent", saving && "opacity-50")}>
          {saving ? "保存中…" : "活動を登録"}
        </button>
        <button type="button" onClick={() => router.back()} className="text-sm text-ink/50 hover:text-ink">キャンセル</button>
      </div>
    </div>
  );
}
