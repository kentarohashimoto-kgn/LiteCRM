import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { createAccountAction } from "@/server/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export default function NewAccountPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="顧客を追加" subtitle="新しい会社を登録します。" />
      <form action={createAccountAction} className="card card-pad space-y-4">
        <div>
          <label className="label">会社名 *</label>
          <input name="name" required className="input" placeholder="株式会社○○" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">業種</label><input name="industry" className="input" /></div>
          <div><label className="label">エリア</label><input name="area" className="input" /></div>
          <div><label className="label">従業員規模</label>
            <select name="employee_size" className="input">
              <option value="">—</option><option>~50</option><option>51~300</option><option>301~1000</option><option>1001~</option>
            </select>
          </div>
          <div><label className="label">Webサイト</label><input name="website_url" className="input" placeholder="https://" /></div>
          <div><label className="label">区分</label>
            <select name="status" defaultValue="prospect" className="input">
              <option value="prospect">見込み</option><option value="customer">顧客</option><option value="inactive">休眠</option>
            </select>
          </div>
          <div><label className="label">優先度</label>
            <select name="priority" className="input"><option value="">—</option><option>A</option><option>B</option><option>C</option></select>
          </div>
        </div>
        <div><label className="label">メモ</label><textarea name="notes" rows={3} className="input" /></div>
        <div className="flex gap-2 pt-2">
          <SubmitButton className="btn-primary" pendingLabel="登録中…">登録する</SubmitButton>
          <Link href="/app/accounts" className="btn-ghost">キャンセル</Link>
        </div>
      </form>
    </div>
  );
}
