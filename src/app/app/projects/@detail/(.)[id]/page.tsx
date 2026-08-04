import ProjectDetailPage from "../../[id]/page";
import { ProjectPane } from "@/components/projects/project-pane";

/**
 * 原価管理(カレンダー/一覧)からのクリックを横取りして、案件詳細を
 * スライドオーバーで表示するインターセプトルート。元の画面はマウントされたまま。
 * 直リンク/リロード時はこのルートはマッチせず、フルページ([id]/page.tsx)になる。
 * ?from=calendar|list で閉じたときの戻り先タブを指定する。
 */
export default async function InterceptedProjectDetail(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ from?: string; saved?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const backHref =
    searchParams.from === "calendar" ? "/app/projects?view=calendar"
    : searchParams.from === "list" ? "/app/projects"
    : null;
  return (
    <ProjectPane oppId={params.id} backHref={backHref}>
      {/* Next 15 では params / searchParams は Promise。解決済みの値ではなく
          Promise のまま渡し、受け側([id]/page.tsx)で await させる。 */}
      <ProjectDetailPage params={props.params} searchParams={props.searchParams} />
    </ProjectPane>
  );
}
