import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * AI Lab のデータアクセス。
 *
 * 受講者は Supabase Auth のユーザーではないので RLS が効かせられない。
 * したがって service_role で読み書きし、**company_id / user_id の絞り込みをこの層で必ず付ける**。
 * 画面や API 側で生クエリを書かないこと(スコープ漏れの入口になる)。
 */

export interface LabCompanyRow {
  id: string;
  tenant_id: string;
  account_id: string | null;
  name: string;
  slug: string;
  basic_user: string;
  allowed_models: string[];
  default_model: string;
  monthly_token_budget: number | null;
  is_active: boolean;
  file_tools_enabled: boolean;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
}

export interface LabUserRow {
  id: string;
  tenant_id: string;
  company_id: string;
  login_id: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
  is_preview: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
}

export interface LabPresetRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_key: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface LabAssetRow {
  id: string;
  preset_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  extracted_text: string;
  created_at: string;
}

export interface LabConversationRow {
  id: string;
  company_id: string;
  user_id: string;
  preset_id: string | null;
  title: string;
  last_model_key: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface LabMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  model_key: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  image_paths: string[] | null;
  error_code: string | null;
  created_at: string;
}

const COMPANY_COLS =
  "id, tenant_id, account_id, name, slug, basic_user, allowed_models, default_model, monthly_token_budget, is_active, file_tools_enabled, starts_on, ends_on, created_at";

export function labDb() {
  return getSupabaseAdmin();
}

/** 会社の有効期間内か。期間未設定なら常に有効。 */
export function isCompanyOpen(company: Pick<LabCompanyRow, "is_active" | "starts_on" | "ends_on">, today = new Date()): boolean {
  if (!company.is_active) return false;
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (company.starts_on && ymd < company.starts_on) return false;
  if (company.ends_on && ymd > company.ends_on) return false;
  return true;
}

export async function getCompanyBySlug(slug: string): Promise<LabCompanyRow | null> {
  const { data } = await labDb().from("ai_lab_companies").select(COMPANY_COLS).eq("slug", slug).maybeSingle();
  return (data as LabCompanyRow | null) ?? null;
}

export async function getCompanyById(id: string): Promise<LabCompanyRow | null> {
  const { data } = await labDb().from("ai_lab_companies").select(COMPANY_COLS).eq("id", id).maybeSingle();
  return (data as LabCompanyRow | null) ?? null;
}

export async function getUserByLoginId(companyId: string, loginId: string): Promise<LabUserRow | null> {
  const { data } = await labDb()
    .from("ai_lab_users")
    .select("*")
    .eq("company_id", companyId)
    .eq("login_id", loginId)
    .maybeSingle();
  return (data as LabUserRow | null) ?? null;
}

export async function getUserById(id: string): Promise<LabUserRow | null> {
  const { data } = await labDb().from("ai_lab_users").select("*").eq("id", id).maybeSingle();
  return (data as LabUserRow | null) ?? null;
}

export async function getPreviewUser(companyId: string): Promise<LabUserRow | null> {
  const { data } = await labDb()
    .from("ai_lab_users")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_preview", true)
    .limit(1)
    .maybeSingle();
  return (data as LabUserRow | null) ?? null;
}

export async function listPresets(companyId: string): Promise<LabPresetRow[]> {
  const { data } = await labDb()
    .from("ai_lab_presets")
    .select("id, company_id, name, description, system_prompt, model_key, sort_order, is_active")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as LabPresetRow[] | null) ?? [];
}

/** 受講者に見せるのは有効なプリセットだけ。 */
export async function listActivePresets(companyId: string): Promise<LabPresetRow[]> {
  return (await listPresets(companyId)).filter((p) => p.is_active);
}

export async function getPreset(companyId: string, presetId: string): Promise<LabPresetRow | null> {
  const { data } = await labDb()
    .from("ai_lab_presets")
    .select("id, company_id, name, description, system_prompt, model_key, sort_order, is_active")
    .eq("company_id", companyId)
    .eq("id", presetId)
    .maybeSingle();
  return (data as LabPresetRow | null) ?? null;
}

export async function listAssets(companyId: string, presetId: string): Promise<LabAssetRow[]> {
  const { data } = await labDb()
    .from("ai_lab_assets")
    .select("id, preset_id, file_name, mime, size_bytes, extracted_text, created_at")
    .eq("company_id", companyId)
    .eq("preset_id", presetId)
    .order("created_at", { ascending: true });
  return (data as LabAssetRow[] | null) ?? [];
}

export async function listConversations(userId: string, limit = 50): Promise<LabConversationRow[]> {
  const { data } = await labDb()
    .from("ai_lab_conversations")
    .select("id, company_id, user_id, preset_id, title, last_model_key, is_archived, created_at, updated_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data as LabConversationRow[] | null) ?? [];
}

/** 会話は必ず「本人のもの」として引く。他人の会話IDを渡されても null になる。 */
export async function getConversation(userId: string, conversationId: string): Promise<LabConversationRow | null> {
  const { data } = await labDb()
    .from("ai_lab_conversations")
    .select("id, company_id, user_id, preset_id, title, last_model_key, is_archived, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as LabConversationRow | null) ?? null;
}

export async function listMessages(conversationId: string, limit = 200): Promise<LabMessageRow[]> {
  const { data } = await labDb()
    .from("ai_lab_messages")
    .select("id, conversation_id, role, content, model_key, provider, input_tokens, output_tokens, image_paths, error_code, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data as LabMessageRow[] | null) ?? [];
}

/** 直近1分の送信数。レート制限の判定に使う。 */
export async function recentUserMessageCount(userId: string, kind: "text" | "image"): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  let q = labDb()
    .from("ai_lab_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since);
  // 画像は「画像生成の依頼」だけを数えたいので、モデルで絞る。
  if (kind === "image") q = q.eq("model_key", "image-gen");
  const { count } = await q;
  return count ?? 0;
}

/** 当月の消費トークン(入出力合算)。予算判定に使う。 */
export async function monthlyTokensUsed(companyId: string, from: string, to: string): Promise<number> {
  const { data } = await labDb()
    .from("ai_lab_usage_daily")
    .select("input_tokens, output_tokens")
    .eq("company_id", companyId)
    .gte("date", from)
    .lte("date", to);
  const rows = (data as { input_tokens: number; output_tokens: number }[] | null) ?? [];
  return rows.reduce((acc, r) => acc + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0), 0);
}

export async function addUsage(params: {
  tenantId: string;
  companyId: string;
  userId: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  images?: number;
}): Promise<void> {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await labDb().rpc("ai_lab_add_usage", {
    p_tenant: params.tenantId,
    p_company: params.companyId,
    p_user: params.userId,
    p_date: date,
    p_model: params.modelKey,
    p_requests: 1,
    p_in: params.inputTokens,
    p_out: params.outputTokens,
    p_images: params.images ?? 0,
  });
}

// ===================== 添付・生成ファイル =====================

export interface LabAttachmentRow {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  origin: "upload" | "generated";
  kind: "image" | "document" | "output";
  file_name: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

const ATTACHMENT_COLS =
  "id, conversation_id, message_id, origin, kind, file_name, mime, size_bytes, storage_path, created_at";

export const UPLOAD_BUCKET = "ai-lab-uploads";
export const OUTPUT_BUCKET = "ai-lab-generated";

export function bucketFor(origin: "upload" | "generated"): string {
  return origin === "upload" ? UPLOAD_BUCKET : OUTPUT_BUCKET;
}

export async function createAttachment(params: {
  tenantId: string;
  companyId: string;
  userId: string;
  origin: "upload" | "generated";
  kind: "image" | "document" | "output";
  fileName: string;
  mime: string;
  sizeBytes: number;
  storagePath: string;
  conversationId?: string | null;
  messageId?: string | null;
}): Promise<LabAttachmentRow | null> {
  const { data } = await labDb()
    .from("ai_lab_attachments")
    .insert({
      tenant_id: params.tenantId,
      company_id: params.companyId,
      user_id: params.userId,
      origin: params.origin,
      kind: params.kind,
      file_name: params.fileName,
      mime: params.mime,
      size_bytes: params.sizeBytes,
      storage_path: params.storagePath,
      conversation_id: params.conversationId ?? null,
      message_id: params.messageId ?? null,
    })
    .select(ATTACHMENT_COLS)
    .single();
  return (data as LabAttachmentRow | null) ?? null;
}

/**
 * 添付を「本人がアップロードした、まだ送信していないもの」に限って取り出す。
 * 他人のIDを渡されても、会社・利用者・未送信の3条件で弾かれる。
 */
export async function getPendingAttachments(
  companyId: string,
  userId: string,
  ids: string[],
): Promise<LabAttachmentRow[]> {
  if (ids.length === 0) return [];
  const { data } = await labDb()
    .from("ai_lab_attachments")
    .select(ATTACHMENT_COLS)
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("origin", "upload")
    .is("message_id", null)
    .in("id", ids);
  return (data as LabAttachmentRow[] | null) ?? [];
}

/** 送信確定時に、添付を会話とメッセージへ結び付ける。 */
export async function attachToMessage(
  ids: string[],
  conversationId: string,
  messageId: string,
): Promise<void> {
  if (ids.length === 0) return;
  await labDb()
    .from("ai_lab_attachments")
    .update({ conversation_id: conversationId, message_id: messageId })
    .in("id", ids);
}

export async function listAttachmentsForConversation(conversationId: string): Promise<LabAttachmentRow[]> {
  const { data } = await labDb()
    .from("ai_lab_attachments")
    .select(ATTACHMENT_COLS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data as LabAttachmentRow[] | null) ?? [];
}

/** Storage から実体を取り出す。モデルへ渡す直前にだけ呼ぶ。 */
export async function downloadAttachment(row: LabAttachmentRow): Promise<Buffer | null> {
  const { data } = await labDb().storage.from(bucketFor(row.origin)).download(row.storage_path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** 添付/生成物の署名URL(パス→URL)。会話単位でまとめて発行する。 */
export async function signAttachmentUrls(
  rows: LabAttachmentRow[],
  expiresInSec = 600,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const byBucket = new Map<string, LabAttachmentRow[]>();
  for (const r of rows) {
    const bucket = bucketFor(r.origin);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), r]);
  }
  for (const [bucket, list] of byBucket) {
    const { data } = await labDb()
      .storage.from(bucket)
      .createSignedUrls(
        list.map((r) => r.storage_path),
        expiresInSec,
      );
    for (const row of data ?? []) {
      const key = (row as { path?: string | null }).path;
      if (key && row.signedUrl) {
        const match = list.find((r) => r.storage_path === key);
        if (match) out[match.id] = row.signedUrl;
      }
    }
  }
  return out;
}

/** 生成画像は非公開バケットに置き、表示のたびに短命の署名URLを作る。 */
export async function signImageUrls(paths: string[], expiresInSec = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data } = await labDb().storage.from("ai-lab-generated").createSignedUrls(paths, expiresInSec);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
}

/**
 * 会話全体ぶんの画像をまとめて署名する(メッセージごとに呼ぶとStorageへの往復が増えるため)。
 * 署名に失敗したパスは戻り値に含まれないので、呼び出し側は欠落を許容すること。
 */
export async function signImageUrlMap(paths: string[], expiresInSec = 600): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data } = await labDb().storage.from("ai-lab-generated").createSignedUrls(unique, expiresInSec);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    // path は createSignedUrls の戻りに含まれる(型定義では optional)。
    const key = (row as { path?: string | null }).path;
    if (key && row.signedUrl) map[key] = row.signedUrl;
  }
  return map;
}
