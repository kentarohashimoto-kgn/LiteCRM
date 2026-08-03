import { notFound } from "next/navigation";
import { FileText, Plus, Trash2, Wand2 } from "lucide-react";
import { requireAdminCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ActionNotice } from "@/components/ui/action-notice";
import { EmptyState, PageHeader, Section } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyTabs } from "@/components/ai-lab/admin/company-tabs";
import { LAB_MODELS } from "@/lib/ai-lab/models";
import { ASSET_INJECT_LIMIT, buildSystemPrompt } from "@/lib/ai-lab/prompt";
import {
  deleteAssetAction,
  deletePresetAction,
  saveAssetAction,
  savePresetAction,
} from "@/server/actions/ai-lab-admin";

export const dynamic = "force-dynamic";

interface Preset {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_key: string | null;
  sort_order: number;
  is_active: boolean;
}
interface Asset {
  id: string;
  preset_id: string;
  file_name: string;
  extracted_text: string;
  size_bytes: number;
}

/**
 * プリセット管理。
 * 「スライド作成のときにデザインガイドを仕込んでおく」といった研修シナリオを、
 * システムプロンプト＋参照アセットの組で用意する画面。
 */
export default async function AiLabPresetsPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { saved?: string; error?: string };
}) {
  await requireAdminCtx();
  const sb = getSupabaseServer();

  const [{ data: company }, presetsR, assetsR] = await Promise.all([
    sb.from("ai_lab_companies").select("id, name").eq("id", params.companyId).maybeSingle(),
    sb
      .from("ai_lab_presets")
      .select("id, name, description, system_prompt, model_key, sort_order, is_active")
      .eq("company_id", params.companyId)
      .order("sort_order")
      .order("created_at"),
    sb
      .from("ai_lab_assets")
      .select("id, preset_id, file_name, extracted_text, size_bytes")
      .eq("company_id", params.companyId)
      .order("created_at"),
  ]);
  if (!company) notFound();

  const presets = (presetsR.data ?? []) as Preset[];
  const assets = (assetsR.data ?? []) as Asset[];
  const assetsByPreset = new Map<string, Asset[]>();
  for (const a of assets) {
    assetsByPreset.set(a.preset_id, [...(assetsByPreset.get(a.preset_id) ?? []), a]);
  }

  return (
    <div>
      <PageHeader
        title={company.name as string}
        subtitle="システムプロンプトと参照アセットのプリセット。受講者は新規チャット開始時に選べます。"
      />
      <CompanyTabs companyId={params.companyId} active="presets" />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          preset_created: "プリセットを作成しました。",
          preset_saved: "プリセットを保存しました。",
          preset_deleted: "プリセットを削除しました。",
          asset_saved: "参考資料を登録しました。",
          asset_deleted: "参考資料を削除しました。",
        }}
      />

      <Section title={`プリセット（${presets.length}件）`} icon={<Wand2 size={14} />} className="mb-6">
        {presets.length === 0 ? (
          <EmptyState message="まだプリセットがありません。下のフォームから作成してください。" />
        ) : (
          <div className="space-y-3">
            {presets.map((p) => {
              const list = assetsByPreset.get(p.id) ?? [];
              const built = buildSystemPrompt(p, list);
              return (
                <details key={p.id} className="rounded-xl border border-black/[0.06] p-4">
                  <summary className="cursor-pointer list-none">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{p.name}</span>
                      {!p.is_active && <span className="pill bg-ink/10 text-ink/55">非公開</span>}
                      {p.model_key && (
                        <span className="pill bg-teal-light text-teal-deep">
                          {LAB_MODELS.find((m) => m.key === p.model_key)?.label ?? p.model_key} 固定
                        </span>
                      )}
                      <span className="text-xs text-ink/45">参考資料 {list.length}件</span>
                      {built.truncated && (
                        <span className="pill bg-amber-100 text-amber-700">
                          注入上限（{ASSET_INJECT_LIMIT.toLocaleString()}字）で切り詰められます
                        </span>
                      )}
                    </span>
                  </summary>

                  <form action={savePresetAction} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input type="hidden" name="companyId" value={params.companyId} />
                    <input type="hidden" name="id" value={p.id} />
                    <div>
                      <label className="label">プリセット名</label>
                      <input name="name" required defaultValue={p.name} className="input" />
                    </div>
                    <div>
                      <label className="label">説明（受講者に表示）</label>
                      <input name="description" defaultValue={p.description ?? ""} className="input" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="label">システムプロンプト（受講者には表示されません）</label>
                      <textarea name="systemPrompt" rows={6} defaultValue={p.system_prompt} className="input font-mono text-xs" />
                    </div>
                    <div>
                      <label className="label">モデル固定</label>
                      <select name="modelKey" className="input" defaultValue={p.model_key ?? ""}>
                        <option value="">固定しない（受講者が選択）</option>
                        {LAB_MODELS.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex-1">
                        <label className="label">表示順</label>
                        <input name="sortOrder" type="number" defaultValue={p.sort_order} className="input" />
                      </div>
                      <label className="flex items-center gap-2 pb-2.5 text-sm">
                        <input type="checkbox" name="isActive" value="1" defaultChecked={p.is_active} />
                        公開する
                      </label>
                    </div>
                    <div className="md:col-span-2 flex items-center gap-3">
                      <SubmitButton pendingLabel="保存中…">保存する</SubmitButton>
                      <span className="text-xs text-ink/45">
                        注入される参考資料: {built.assetChars.toLocaleString()}字
                      </span>
                    </div>
                  </form>

                  {/* 参考資料 */}
                  <div className="mt-5 border-t border-black/[0.06] pt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                      <FileText size={13} />
                      参考資料（デザインガイドなど）
                    </p>
                    {list.length > 0 && (
                      <ul className="mb-3 space-y-1">
                        {list.map((a) => (
                          <li key={a.id} className="flex items-center gap-3 text-sm">
                            <span className="font-medium text-ink/80">{a.file_name}</span>
                            <span className="text-xs text-ink/45">{a.size_bytes.toLocaleString()}字</span>
                            <form action={deleteAssetAction}>
                              <input type="hidden" name="companyId" value={params.companyId} />
                              <input type="hidden" name="id" value={a.id} />
                              <SubmitButton
                                className="inline-flex items-center gap-1 text-xs text-ink/40 hover:text-rose-600"
                                pendingLabel="削除中…"
                              >
                                <Trash2 size={12} />
                                削除
                              </SubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={saveAssetAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input type="hidden" name="companyId" value={params.companyId} />
                      <input type="hidden" name="presetId" value={p.id} />
                      <div>
                        <label className="label">資料名</label>
                        <input name="fileName" className="input" placeholder="デザインガイド" />
                      </div>
                      <div>
                        <label className="label">ファイル（.txt / .md / .csv）</label>
                        <input name="file" type="file" accept=".txt,.md,.markdown,.csv" className="input py-1.5" />
                      </div>
                      <div className="md:col-span-2">
                        <label className="label">またはテキストを直接貼り付け</label>
                        <textarea name="text" rows={4} className="input font-mono text-xs" />
                      </div>
                      <div className="md:col-span-2">
                        <SubmitButton className="btn-ghost inline-flex items-center gap-1.5 text-sm" pendingLabel="登録中…">
                          <Plus size={13} />
                          参考資料を追加
                        </SubmitButton>
                      </div>
                    </form>
                  </div>

                  <div className="mt-4 border-t border-black/[0.06] pt-3">
                    <form action={deletePresetAction}>
                      <input type="hidden" name="companyId" value={params.companyId} />
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton
                        className="inline-flex items-center gap-1 text-xs text-ink/40 hover:text-rose-600"
                        pendingLabel="削除中…"
                      >
                        <Trash2 size={12} />
                        このプリセットを削除
                      </SubmitButton>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="プリセットを追加" icon={<Plus size={14} />}>
        <form action={savePresetAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input type="hidden" name="companyId" value={params.companyId} />
          <div>
            <label className="label">プリセット名</label>
            <input name="name" required className="input" placeholder="スライド骨子作成" />
          </div>
          <div>
            <label className="label">説明（受講者に表示）</label>
            <input name="description" className="input" placeholder="自社のトンマナに沿ったスライド構成を作ります" />
          </div>
          <div className="md:col-span-2">
            <label className="label">システムプロンプト</label>
            <textarea
              name="systemPrompt"
              rows={5}
              className="input font-mono text-xs"
              placeholder="あなたは提案書作成のアシスタントです。参考資料のデザインガイドに従い…"
            />
          </div>
          <div>
            <label className="label">モデル固定</label>
            <select name="modelKey" className="input" defaultValue="">
              <option value="">固定しない（受講者が選択）</option>
              {LAB_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="label">表示順</label>
              <input name="sortOrder" type="number" defaultValue={0} className="input" />
            </div>
            <label className="flex items-center gap-2 pb-2.5 text-sm">
              <input type="checkbox" name="isActive" value="1" defaultChecked />
              公開する
            </label>
          </div>
          <div className="md:col-span-2">
            <SubmitButton pendingLabel="作成中…">作成する</SubmitButton>
          </div>
        </form>
      </Section>
    </div>
  );
}
