import ProjectDetailPage from "../../[id]/page";
import { ProjectPane } from "@/components/projects/project-pane";

/**
 * 原価管理(カレンダー/一覧)からのクリックを横取りして、案件詳細を
 * スライドオーバーで表示するインターセプトルート。元の画面はマウントされたまま。
 * 直リンク/リロード時はこのルートはマッチせず、フルページ([id]/page.tsx)になる。
 * ?from=calendar|list で閉じたときの戻り先タブを指定する。
 */
export default async function InterceptedProjectDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; saved?: string };
}) {
  const backHref =
    searchParams.from === "calendar" ? "/app/projects?view=calendar"
    : searchParams.from === "list" ? "/app/projects"
    : null;
  return (
    <ProjectPane oppId={params.id} backHref={backHref}>
      <ProjectDetailPage params={params} searchParams={searchParams} />
    </ProjectPane>
  );
}
