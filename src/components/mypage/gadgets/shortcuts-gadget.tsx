import Link from "next/link";
import { ArrowUpRight, Link2 } from "lucide-react";
import { Card, Section } from "@/components/ui/primitives";
import { navGroupsFor } from "@/components/layout/nav-config";
import { shortcutOptionsFor } from "@/lib/mypage";
import type { Role } from "@/lib/types";

/**
 * ショートカットガジェット: よく使う画面へのリンクタイル。
 * 選択肢はロール別ナビと同じ源泉(shortcutOptionsFor)のため、権限外画面は出ない。
 */
export function ShortcutsGadget({ role, hrefs }: { role: Role; hrefs: string[] }) {
  const options = new Map(shortcutOptionsFor(role).map((o) => [o.href, o]));
  const icons = new Map<string, React.ElementType>();
  for (const g of navGroupsFor(role)) for (const item of g.items) if (!icons.has(item.href)) icons.set(item.href, item.icon);

  const items = hrefs.map((h) => options.get(h)).filter((o): o is NonNullable<typeof o> => Boolean(o));
  return (
    <Section title="ショートカット" icon={<Link2 size={16} />}>
      <Card className="p-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 p-2">
            ショートカット未設定です。右上の「カスタマイズ」からよく使う画面を追加できます。
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {items.map((o) => {
              const Icon = icons.get(o.href) ?? ArrowUpRight;
              return (
                <Link
                  key={o.href}
                  href={o.href}
                  className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-teal-400 hover:bg-teal-50/50 transition-colors"
                >
                  <Icon size={16} className="text-teal-600 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-700 truncate group-hover:text-teal-700">{o.label}</span>
                    <span className="block text-[10px] text-slate-400">{o.group}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </Section>
  );
}
