import { Section } from "@/components/ui/primitives";
import { SOUVENIR_STATUS, type SolutionPackage, type AccountSouvenir } from "@/lib/data/souvenirs";
import { addAccountSouvenirAction, updateAccountSouvenirAction, deleteAccountSouvenirAction } from "@/server/actions/souvenirs";

const STATUS_STYLE: Record<string, string> = {
  candidate: "bg-mist-soft text-ink/55",
  presented: "bg-amber-50 text-accent-orange",
  proposed: "bg-teal-light text-teal-deep",
  declined: "bg-rose-50 text-rose-500",
};

export function SouvenirSection({
  accountId,
  souvenirs,
  packages,
}: {
  accountId: string;
  souvenirs: AccountSouvenir[];
  packages: SolutionPackage[];
}) {
  // まだ候補化していないパッケージ（追加用）
  const usedIds = new Set(souvenirs.map((s) => s.package_id));
  const addable = packages.filter((p) => !usedIds.has(p.id));

  return (
    <Section
      title="お土産提案（アップセル候補）"
      action={<span className="text-[11px] text-ink/40">候補を事前設定し、反応を見て提案を選ぶ</span>}
    >
      {souvenirs.length === 0 ? (
        <p className="text-sm text-ink/40 py-3">お土産候補が未設定です。下から追加してください。</p>
      ) : (
        <ul className="space-y-2.5">
          {souvenirs.map((s) => (
            <li key={s.id} className="rounded-xl border border-black/[0.06] p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm text-ink flex-1">{s.package_name}</span>
                <span className={`pill text-[10px] ${STATUS_STYLE[s.status] ?? "bg-mist-soft text-ink/55"}`}>
                  {SOUVENIR_STATUS.find((x) => x.key === s.status)?.label ?? s.status}
                </span>
                <form action={deleteAccountSouvenirAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="account_id" value={accountId} />
                  <button type="submit" className="text-xs text-ink/30 hover:text-rose-500" title="削除">×</button>
                </form>
              </div>
              <form action={updateAccountSouvenirAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="account_id" value={accountId} />
                <div>
                  <label className="block text-[10px] text-ink/45 mb-0.5">ステータス</label>
                  <select name="status" defaultValue={s.status} className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-teal-primary">
                    {SOUVENIR_STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[10px] text-ink/45 mb-0.5">顧客反応</label>
                  <input name="customer_reaction" defaultValue={s.customer_reaction ?? ""} placeholder="例：eラーニングに強い関心。予算は来期" className="input py-1 text-xs" />
                </div>
                <button type="submit" className="btn-ghost text-xs py-1">保存</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {addable.length > 0 && (
        <form action={addAccountSouvenirAction} className="mt-3 flex items-center gap-2 border-t border-black/[0.05] pt-3">
          <input type="hidden" name="account_id" value={accountId} />
          <select name="package_id" required defaultValue="" className="input py-1.5 text-sm flex-1">
            <option value="" disabled>お土産候補を選択</option>
            {addable.map((p) => <option key={p.id} value={p.id}>{p.package_name}</option>)}
          </select>
          <button type="submit" className="btn-accent text-sm whitespace-nowrap">候補に追加</button>
        </form>
      )}
    </Section>
  );
}
