import { redirect } from "next/navigation";

/** /lab/{slug} は入口。ログイン状態の判定はチャット画面側(requireLabCtx)に任せる。 */
export default async function LabIndexPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  redirect(`/lab/${params.slug}/chat`);
}
