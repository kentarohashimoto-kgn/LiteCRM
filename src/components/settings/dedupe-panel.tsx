"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Loader2 } from "lucide-react";
import {
  mergeAccountsAction,
  mergeLeadsAction,
  type DupAccountItem,
  type DupGroup,
  type DupLeadItem,
} from "@/server/actions/dedupe";

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 1グループ分のマージUI: 残す1件をラジオで選び、それ以外をマージ。 */
function GroupCard({
  groupKey,
  rows,
  canMerge,
  onMerge,
}: {
  groupKey: string;
  rows: { id: string; title: string; sub: string }[];
  canMerge: boolean;
  onMerge: (primaryId: string, dupIds: string[]) => Promise<{ ok: boolean; error?: string; moved?: number }>;
}) {
  const router = useRouter();
  const [primary, setPrimary] = useState(rows[0]?.id ?? "");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();

  const run = () => {
    const dupIds = rows.filter((r) => r.id !== primary).map((r) => r.id);
    if (dupIds.length === 0) return;
    if (!window.confirm(`${dupIds.length}件を「${rows.find((r) => r.id === primary)?.title}」へマージします。\n関連データ(案件・商談・活動など)は残す側へ付け替えられ、重複側はゴミ箱へ移動します。\nFKの付け替えは元に戻せません。実行しますか？`)) return;
    setError("");
    startTransition(async () => {
      const res = await onMerge(primary, dupIds);
      if (!res.ok) {
        setError(res.error ?? "マージに失敗しました");
        return;
      }
      setDone(`マージしました（付け替え ${res.moved ?? 0}件）`);
      router.refresh();
    });
  };

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
        {groupKey}: {done}
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="text-xs text-ink/40 mb-2">一致キー: <span className="font-mono">{groupKey}</span></div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 text-sm">
            <input
              type="radio"
              name={`primary-${groupKey}`}
              checked={primary === r.id}
              onChange={() => setPrimary(r.id)}
              className="accent-teal-600"
              aria-label={`${r.title} を残す`}
            />
            <span className={`min-w-0 truncate ${primary === r.id ? "font-medium text-ink" : "text-ink/70"}`}>{r.title}</span>
            <span className="text-xs text-ink/40 shrink-0 ml-auto">{r.sub}</span>
            {primary === r.id && <span className="pill bg-teal-light text-teal-deep shrink-0">残す</span>}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      {canMerge ? (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-teal-primary/40 bg-teal-light text-teal-deep px-3 py-1.5 text-sm hover:bg-teal-light/70 disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
          残り{rows.length - 1}件をマージ
        </button>
      ) : (
        <p className="text-[11px] text-ink/35 mt-2">マージの実行は管理者(owner/admin)のみ可能です。</p>
      )}
    </div>
  );
}

export function DedupePanel({
  accountGroups,
  leadGroups,
  canMerge,
}: {
  accountGroups: DupGroup<DupAccountItem>[];
  leadGroups: DupGroup<DupLeadItem>[];
  canMerge: boolean;
}) {
  const [tab, setTab] = useState<"accounts" | "leads">(accountGroups.length > 0 ? "accounts" : "leads");

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab("accounts")}
          className={`rounded-xl px-3.5 py-1.5 text-sm border ${tab === "accounts" ? "bg-teal-light text-teal-deep border-teal-primary/40 font-medium" : "border-black/10 text-ink/60 hover:bg-black/[0.03]"}`}
        >
          顧客 {accountGroups.length}組
        </button>
        <button
          type="button"
          onClick={() => setTab("leads")}
          className={`rounded-xl px-3.5 py-1.5 text-sm border ${tab === "leads" ? "bg-teal-light text-teal-deep border-teal-primary/40 font-medium" : "border-black/10 text-ink/60 hover:bg-black/[0.03]"}`}
        >
          リード {leadGroups.length}組
        </button>
      </div>

      {tab === "accounts" && (
        <div className="space-y-4">
          {accountGroups.length === 0 && <p className="text-sm text-ink/40 py-8 text-center">会社名が一致する重複候補はありません</p>}
          {accountGroups.map((g) => (
            <GroupCard
              key={g.key}
              groupKey={g.key}
              canMerge={canMerge}
              rows={g.items.map((a) => ({
                id: a.id,
                title: a.name,
                sub: `${a.industry ?? "—"} ・ 案件${a.opp_count}件 ・ ${fmtDate(a.created_at)}作成`,
              }))}
              onMerge={(primaryId, dupIds) => mergeAccountsAction({ primaryId, dupIds })}
            />
          ))}
        </div>
      )}

      {tab === "leads" && (
        <div className="space-y-4">
          {leadGroups.length === 0 && <p className="text-sm text-ink/40 py-8 text-center">メールアドレスが一致する重複候補はありません</p>}
          {leadGroups.map((g) => (
            <GroupCard
              key={g.key}
              groupKey={g.key}
              canMerge={canMerge}
              rows={g.items.map((l) => ({
                id: l.id,
                title: `${l.company_name ?? "(会社名なし)"}${l.contact_name ? `｜${l.contact_name}` : ""}`,
                sub: `${l.raw_event ?? "—"} ・ 案件${l.opp_count}件 ・ ${fmtDate(l.acquired_at ?? l.created_at)}獲得`,
              }))}
              onMerge={(primaryId, dupIds) => mergeLeadsAction({ primaryId, dupIds })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
