import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireHrCtx } from "@/lib/session";
import { getTalentRoster, countByCompany } from "@/lib/data/talents";
import { PageHeader, Section, Card } from "@/components/ui/primitives";
import { ActionNotice } from "@/components/ui/action-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTalentCompanyAction, updateTalentCompanyAction } from "@/server/actions/talent-companies";

export const dynamic = "force-dynamic";

/**
 * 所属会社(請求元)マスタ。担当者の「どこの会社所属か」の選択肢になり、
 * 会社ごとの月末請求額(請求サマリー)の集計単位になる。
 */
export default async function TalentCompaniesPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  await requireHrCtx();
  const { talents, companies } = await getTalentRoster();
  const counts = countByCompany(talents);
  const individuals = talents.filter((t) => t.affiliation_type === "individual").length;
  const unset = talents.filter((t) => t.affiliation_type === "unset").length;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="所属会社マスタ"
        subtitle="担当者の所属先（請求元）です。ここに登録した会社が、稼働実績から算出する月次請求サマリーの集計単位になります。個人事業主は会社登録せず、台帳で「個人（個人事業主）」を選びます。"
        action={<Link href="/app/hr/talents" className="btn-ghost text-xs">タレント台帳へ</Link>}
      />

      <ActionNotice
        saved={searchParams.saved}
        error={searchParams.error}
        savedMessages={{
          create: "所属会社を登録しました。タレント台帳で担当者の所属に選べます。",
          save: "保存しました。",
          delete: "削除しました。",
        }}
        errorMessages={{
          invalid: "会社名を入力してください。",
          duplicate: "同じ名前の会社がすでに登録されています（表記ゆれで請求先が割れるのを防ぐため重複は登録できません）。",
          in_use: "この会社に所属している担当者がいるため削除できません。先に台帳で所属を付け替えてください。",
          load_failed: "データの読み込みに失敗しました。再度お試しください。",
          save_failed: "保存に失敗しました。再度お試しください。",
        }}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card><div className="text-xs text-ink/50">登録会社</div><div className="stat-value mt-1">{companies.length}<span className="stat-unit">社</span></div></Card>
        <Card><div className="text-xs text-ink/50">会社所属の担当者</div><div className="stat-value mt-1">{talents.length - individuals - unset}<span className="stat-unit">名</span></div></Card>
        <Card><div className="text-xs text-ink/50">個人（個人事業主）</div><div className="stat-value mt-1">{individuals}<span className="stat-unit">名</span></div></Card>
        <Card>
          <div className="text-xs text-ink/50">所属未設定</div>
          <div className={`stat-value mt-1 ${unset ? "text-rose-600" : ""}`}>{unset}<span className="stat-unit">名</span></div>
        </Card>
      </div>

      <Section title="所属会社を追加" className="mb-5">
        <form action={createTalentCompanyAction} className="flex items-end gap-2.5 flex-wrap">
          <div><label className="label">会社名 *</label><input name="name" required className="input w-52" placeholder="株式会社〇〇" /></div>
          <div><label className="label">請求書上の名義</label><input name="billing_name" className="input w-44" placeholder="会社名と異なる場合" /></div>
          <div><label className="label">インボイス登録番号</label><input name="invoice_no" className="input w-40" placeholder="T1234567890123" /></div>
          <div><label className="label">消費税率(%)</label><input name="tax_rate" inputMode="decimal" defaultValue="10" className="input w-20 text-right" /></div>
          <div><label className="label">締め・支払サイト</label><input name="payment_terms" className="input w-44" placeholder="月末締め翌月末払い" /></div>
          <div><label className="label">請求連絡先</label><input name="contact_email" type="email" className="input w-48" /></div>
          <SubmitButton className="btn-accent" pendingLabel="登録中…">追加</SubmitButton>
        </form>
      </Section>

      <Section title={`所属会社（${companies.length}）`}>
        {companies.length === 0 ? (
          <div className="py-10 text-center">
            <Building2 size={26} className="mx-auto text-ink/25 mb-2" />
            <p className="text-sm text-ink/50">まだ所属会社が登録されていません。</p>
            <p className="text-xs text-ink/40 mt-1">担当者が所属している会社（業務委託先・パートナー企業など）を登録してください。</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {companies.map((c) => {
              const n = counts.get(c.id) ?? 0;
              return (
                <li key={c.id} className={`rounded-xl border border-black/[0.05] p-3 ${c.is_active ? "" : "opacity-55"}`}>
                  <form action={updateTalentCompanyAction} className="space-y-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="flex items-center gap-2.5 flex-wrap text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="pill bg-teal-light text-teal-deep text-[10px] font-bold">{n}名 所属</span>
                      {!c.is_active && <span className="pill bg-ink/5 text-ink/45 text-[10px]">休止中</span>}
                      {c.invoice_no && <span className="text-xs text-ink/45 tabular-nums">{c.invoice_no}</span>}
                      <span className="ml-auto" />
                      <SubmitButton className="rounded-lg border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[0.03]" pendingLabel="保存中…">保存</SubmitButton>
                      <button name="op" value="toggle_active" className="text-xs text-ink/45 hover:underline">{c.is_active ? "休止にする" : "再開する"}</button>
                      <button
                        name="op"
                        value="delete"
                        className={n ? "text-xs text-ink/25 cursor-not-allowed" : "text-xs text-rose-500 hover:underline"}
                        disabled={n > 0}
                        title={n ? "所属者がいるため削除できません" : "削除"}
                      >
                        削除
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input name="name" defaultValue={c.name} required className="input w-48 text-xs py-1.5" placeholder="会社名" title="会社名" />
                      <input name="billing_name" defaultValue={c.billing_name ?? ""} className="input w-40 text-xs py-1.5" placeholder="請求書上の名義" title="請求書上の名義" />
                      <input name="invoice_no" defaultValue={c.invoice_no ?? ""} className="input w-36 text-xs py-1.5" placeholder="インボイス登録番号" title="インボイス登録番号" />
                      <label className="inline-flex items-center gap-1 text-xs text-ink/60 whitespace-nowrap">
                        税率
                        <input name="tax_rate" defaultValue={String(Number(c.tax_rate))} inputMode="decimal" className="input w-14 text-xs py-1.5 text-right" title="消費税率(%)。免税事業者は0" />%
                      </label>
                      <input name="payment_terms" defaultValue={c.payment_terms ?? ""} className="input w-40 text-xs py-1.5" placeholder="締め・支払サイト" title="締め・支払サイト" />
                      <input name="contact_email" defaultValue={c.contact_email ?? ""} className="input w-44 text-xs py-1.5" placeholder="請求連絡先" title="請求連絡先" />
                      <input name="notes" defaultValue={c.notes ?? ""} className="input flex-1 min-w-[140px] text-xs py-1.5" placeholder="メモ" />
                    </div>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-ink/40 mt-3">
          税率は請求サマリーの消費税計算に使います（免税事業者は0）。会社名の重複は登録できません（表記ゆれで請求先が割れると月次集計が崩れるため）。
        </p>
      </Section>
    </div>
  );
}
