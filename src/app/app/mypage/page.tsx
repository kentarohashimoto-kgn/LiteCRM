import { Suspense } from "react";
import { requireCtx } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui/primitives";
import { gadgetsFor, normalizeLayout, shortcutOptionsFor, type GadgetSetting } from "@/lib/mypage";
import { MypageCustomizer } from "@/components/mypage/mypage-customizer";
import { ShortcutsGadget } from "@/components/mypage/gadgets/shortcuts-gadget";
import { CalendarGadget } from "@/components/mypage/gadgets/calendar-gadget";
import { TasksGadget } from "@/components/mypage/gadgets/tasks-gadget";
import { ProjectsGadget } from "@/components/mypage/gadgets/projects-gadget";
import { RepWeeklyGadget } from "@/components/mypage/gadgets/rep-weekly-gadget";
import { PmoGadget } from "@/components/mypage/gadgets/pmo-gadget";
import { ROLE_MAP } from "@/lib/constants";
import type { Ctx } from "@/lib/session";

export const dynamic = "force-dynamic";

function GadgetSkeleton() {
  return <Card className="p-4 h-40 animate-pulse bg-slate-50">{null}</Card>;
}

/** ガジェット1枚のレンダリング。重いものは Suspense でストリーミングする。 */
function renderGadget(g: GadgetSetting, ctx: Ctx, shortcuts: string[]) {
  switch (g.key) {
    case "shortcuts":
      return <ShortcutsGadget role={ctx.role} hrefs={shortcuts} />;
    case "calendar":
      return <Suspense fallback={<GadgetSkeleton />}><CalendarGadget /></Suspense>;
    case "tasks":
      return <Suspense fallback={<GadgetSkeleton />}><TasksGadget userId={ctx.userId} /></Suspense>;
    case "projects":
      return <Suspense fallback={<GadgetSkeleton />}><ProjectsGadget /></Suspense>;
    case "rep_weekly":
      return <Suspense fallback={<GadgetSkeleton />}><RepWeeklyGadget userId={ctx.userId} /></Suspense>;
    case "pmo":
      return <Suspense fallback={<GadgetSkeleton />}><PmoGadget /></Suspense>;
    default:
      return null;
  }
}

/**
 * マイページ: ログイン直後の個人ホーム。
 * ガジェット(機能の埋め込み)とショートカットを個人ごとにカスタマイズできる。
 * 表示できるガジェット/ショートカットはロールで制御(gadgetsFor / shortcutOptionsFor)。
 */
export default async function MypagePage() {
  const ctx = await requireCtx();
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("user_home_layouts")
    .select("layout")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const layout = normalizeLayout(data?.layout, ctx.role);

  const gadgetOptions = gadgetsFor(ctx.role).map((g) => ({
    key: g.key,
    label: g.label,
    description: g.description,
    defaultSize: g.defaultSize,
  }));
  const shortcutOptions = shortcutOptionsFor(ctx.role);
  const roleLabel = ROLE_MAP[ctx.role]?.label ?? ctx.role;

  return (
    <div className="space-y-4">
      <PageHeader
        title="マイページ"
        subtitle={`${ctx.email} ／ ${roleLabel}`}
        action={<MypageCustomizer layout={layout} gadgetOptions={gadgetOptions} shortcutOptions={shortcutOptions} />}
      />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {layout.gadgets.map((g) => (
          <div key={g.key} className={g.size === "full" ? "xl:col-span-2" : ""}>
            {renderGadget(g, ctx, layout.shortcuts)}
          </div>
        ))}
      </div>
    </div>
  );
}
