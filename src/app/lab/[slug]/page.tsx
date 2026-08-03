import { redirect } from "next/navigation";

/** /lab/{slug} は入口。ログイン状態の判定はチャット画面側(requireLabCtx)に任せる。 */
export default function LabIndexPage({ params }: { params: { slug: string } }) {
  redirect(`/lab/${params.slug}/chat`);
}
