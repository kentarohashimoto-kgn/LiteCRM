import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * B7 ノウハウ・事例ナレッジのデータ取得。
 * v1は全件(RLSで自テナント)を取得し、テキスト部分一致はJS側で行う(日本語対応)。
 * 参考URL(複数・説明付き)と添付ファイル1件(署名URL)に対応。
 */

export type KnowledgeKind = "knowhow" | "win_reason" | "loss_reason" | "case_study";

export type ReferenceLink = { url: string; label: string | null };

export type KnowledgeEntry = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  is_own_company: boolean;
  industry: string | null;
  competitor: string | null;
  tags: string[];
  created_at: string;
  reference_links: ReferenceLink[];
  attachment_name: string | null;
  attachment_note: string | null;
  attachment_type: string | null;
  attachment_url: string | null; // 署名URL(1時間)。service role未設定時は null。
};

const BUCKET = "attachments";

/* eslint-disable @typescript-eslint/no-explicit-any */
function normLinks(raw: any): ReferenceLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => ({ url: String(l?.url ?? "").trim(), label: l?.label ? String(l.label) : null }))
    .filter((l) => l.url)
    .slice(0, 20);
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("knowledge_entries")
    .select(
      "id,kind,title,body,is_own_company,industry,competitor,tags,created_at,reference_links,attachment_path,attachment_name,attachment_note,attachment_type",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as any[];

  // 添付の署名URL(1時間)。service role未設定なら null(一覧のみ)。
  const paths = rows.map((r) => r.attachment_path).filter(Boolean) as string[];
  let urls = new Map<string, string>();
  if (paths.length) {
    try {
      const admin = getSupabaseAdmin();
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
      urls = new Map(
        (signed ?? [])
          .filter((s): s is typeof s & { signedUrl: string; path: string } => Boolean(s.signedUrl && s.path))
          .map((s) => [s.path, s.signedUrl]),
      );
    } catch {
      /* SUPABASE_SERVICE_ROLE_KEY 未設定 */
    }
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    is_own_company: r.is_own_company,
    industry: r.industry ?? null,
    competitor: r.competitor ?? null,
    tags: r.tags ?? [],
    created_at: r.created_at,
    reference_links: normLinks(r.reference_links),
    attachment_name: r.attachment_name ?? null,
    attachment_note: r.attachment_note ?? null,
    attachment_type: r.attachment_type ?? null,
    attachment_url: r.attachment_path ? urls.get(r.attachment_path) ?? null : null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** テキスト(タイトル/本文/タグ/業種/競合/参考URL説明)への部分一致フィルタ。 */
export function filterKnowledge(entries: KnowledgeEntry[], q: string, kind: string): KnowledgeEntry[] {
  const needle = q.trim().toLowerCase();
  return entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (!needle) return true;
    const hay = [
      e.title,
      e.body,
      e.industry ?? "",
      e.competitor ?? "",
      (e.tags ?? []).join(" "),
      e.reference_links.map((l) => `${l.label ?? ""} ${l.url}`).join(" "),
      e.attachment_name ?? "",
      e.attachment_note ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
}
