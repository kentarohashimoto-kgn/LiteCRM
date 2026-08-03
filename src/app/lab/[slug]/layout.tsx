import type { Metadata } from "next";

/**
 * 顧客向け体験環境のレイアウト。
 * CRM(/app)のレイアウトは通さない。ここでは検索避けだけを付ける
 * (会社別URLが検索結果に出ると、Basic認証の前に環境の存在が知られてしまうため)。
 */
export const metadata: Metadata = {
  title: "生成AI体験環境",
  robots: { index: false, follow: false },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
