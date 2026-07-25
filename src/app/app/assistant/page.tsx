import { PageHeader, Section } from "@/components/ui/primitives";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { fetchIndexStatus } from "@/server/actions/assistant";
import { DOC_CATEGORIES, INDEX_EXCLUDED } from "@/lib/storage/doc-categories";

export const dynamic = "force-dynamic";

/**
 * P4 AIヘルプ画面。CRMに紐付いた社内資料を根拠にAIが回答する。
 * 索引は夜間バッチ(/api/cron/doc-index)が更新し、機微種別(契約書類/請求/人事)は対象外。
 */
export default async function AssistantPage() {
  const status = await fetchIndexStatus();
  const categories = DOC_CATEGORIES.filter((c) => !INDEX_EXCLUDED.includes(c));

  return (
    <div>
      <PageHeader
        title="AIヘルプ"
        subtitle="CRMに紐付いた社内資料（提案書・技術資料・研修資料など）を根拠に回答します。出典の原本リンク付き。"
      />

      {!status.configured && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
          AI回答に必要なAPIキー（OPENAI_API_KEY / ANTHROPIC_API_KEY）が未設定です。管理者がVercelの環境変数に設定すると利用できます。
        </p>
      )}

      <Section
        title="質問する"
        className="mb-5"
        action={
          <span className="text-[11px] text-ink/40">
            索引済み {status.indexed} 件 ・ 待機 {status.pending} 件 ・ 対象外 {status.excluded} 件
          </span>
        }
      >
        <AssistantPanel categories={[...categories]} />
      </Section>

      <Section title="このAIが見ている資料">
        <ul className="text-sm text-ink/60 space-y-1.5 list-disc pl-5">
          <li>案件・顧客・リード・プロジェクトなどCRMの各画面で「ドライブ資料」に紐付けた資料</li>
          <li>共有ドライブ 601_CRM_資料庫 にアップロードした資料（提案書・企画書・研修資料・技術資料・営業ツール）</li>
          <li className="text-ink/45">
            契約書類・請求・人事は学習対象外です。機微情報は 603_CRM_BO に置き、CRMに紐付けない運用にしてください。
          </li>
          <li className="text-ink/45">
            索引は夜間に更新されます。追加直後の資料はまだ回答に反映されないことがあります。
          </li>
        </ul>
      </Section>
    </div>
  );
}
