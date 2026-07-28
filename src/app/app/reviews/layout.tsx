import { requireSalesNumbersCtx } from "@/lib/session";

/** 全社の営業数字を扱う領域。閲覧不可ロール(インサイドセールス/BO専任)はここで遮断する。 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSalesNumbersCtx();
  return <>{children}</>;
}
