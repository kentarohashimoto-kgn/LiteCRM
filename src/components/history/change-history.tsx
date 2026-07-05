import { getSupabaseServer } from "@/lib/supabase/server";
import { Section } from "@/components/ui/primitives";
import { auditChanges, auditKind, type AuditLog } from "@/lib/audit";

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  created: { label: "作成", cls: "bg-teal-light text-teal-deep" },
  updated: { label: "変更", cls: "bg-black/[0.05] text-ink/60" },
  deleted: { label: "ゴミ箱へ", cls: "bg-rose-50 text-rose-600" },
  restored: { label: "復元", cls: "bg-amber-50 text-amber-700" },
  purged: { label: "完全削除", cls: "bg-rose-50 text-rose-600" },
};

/**
 * B-1 変更履歴: audit_logs から「誰が・いつ・何を・どう変えたか」を時系列表示。
 * 案件/顧客の詳細ページに設置するサーバーコンポーネント。
 */
export async function ChangeHistory({ table, recordId }: { table: "opportunities" | "accounts" | "leads"; recordId: string }) {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("audit_logs")
    .select("id, actor_user_id, table_name, record_id, action, before_data, after_data, created_at")
    .eq("table_name", table)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(30);
  const logs = (data ?? []) as unknown as AuditLog[];

  // アクター名の解決(profilesはテナント内全員が参照可)
  const actorIds = Array.from(new Set(logs.map((l) => l.actor_user_id).filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profs } = await sb.from("profiles").select("id, display_name, email").in("id", actorIds);
    for (const p of profs ?? []) names.set(p.id as string, (p.display_name as string) || (p.email as string) || "—");
  }

  return (
    <Section title="変更履歴">
      {logs.length === 0 ? (
        <p className="text-sm text-ink/40 py-2">変更履歴はまだありません（履歴の記録は2026年7月から開始）</p>
      ) : (
        <ul className="space-y-3 text-sm max-h-80 overflow-y-auto pr-1">
          {logs.map((log) => {
            const kind = auditKind(log);
            const k = KIND_LABEL[kind];
            const changes = kind === "updated" ? auditChanges(log) : kind === "deleted" || kind === "restored" ? auditChanges(log).filter((c) => c.key !== "deleted_at") : [];
            return (
              <li key={log.id} className="border-b border-black/[0.04] pb-2.5 last:border-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`pill ${k.cls}`}>{k.label}</span>
                  <span className="text-xs text-ink/40">
                    {formatDateTime(log.created_at)} ・ {log.actor_user_id ? names.get(log.actor_user_id) ?? "—" : "システム"}
                  </span>
                </div>
                {kind === "updated" && changes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {changes.map((c) => (
                      <li key={c.key} className="text-xs text-ink/70">
                        <span className="text-ink/45">{c.label}:</span>{" "}
                        <span className="line-through text-ink/35">{c.before}</span>
                        <span className="text-ink/30 mx-1">→</span>
                        <span className="font-medium">{c.after}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
