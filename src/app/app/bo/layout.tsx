import { requireBoCtx } from "@/lib/session";

/** バックオフィス領域: 事務(back_office)/人事(hr)/管理者のみ。営業系ロールは営業トップへ。 */
export default async function BoLayout({ children }: { children: React.ReactNode }) {
  await requireBoCtx();
  return <>{children}</>;
}
