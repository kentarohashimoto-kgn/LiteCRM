import { requireHrCtx } from "@/lib/session";

/** 人事領域: hr/owner/adminのみ。事務(back_office)や営業系ロールはアクセス不可。 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requireHrCtx();
  return <>{children}</>;
}
