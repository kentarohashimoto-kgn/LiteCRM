"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PenSquare, Eye, MousePointerClick } from "lucide-react";
import { renderEmailTemplate, EMAIL_CATEGORY_LABEL } from "@/lib/email";
import type { SenderVars } from "@/lib/sender";

/**
 * テンプレ設定 ↔ 実際に届くメール の対比プレビュー。
 * 左: テンプレの原文(差し込み変数をハイライト) / 右: サンプル値でレンダリングした受信イメージ
 * (計測リンク変換・配信停止フッター・開封ピクセルの自動付与も右側で可視化)。
 */

export interface TplRow { id: string; name: string; category: string; subject_tmpl: string; body_tmpl: string }

const VAR_LABEL: Record<string, string> = {
  contact: "相手の氏名", company: "会社名", opportunity: "案件名",
  sender: "差出人名", sender_last: "差出人の姓", sender_email: "差出人のメールアドレス", signature: "差出人の署名ブロック",
};

/** 送信方法 × 内容の組み合わせ。配信停止フッターの有無がこれで決まる。 */
type PreviewMode = "bulk_ad" | "bulk_plain" | "single";
const MODE_LABEL: Record<PreviewMode, string> = {
  bulk_ad: "一括 / シーケンス（広告宣伝を含む）",
  bulk_plain: "一括（純粋なお礼・業務連絡のみ）",
  single: "個別メール（1通ずつ）",
};
const MODE_NOTE: Record<PreviewMode, string> = {
  bulk_ad: "",
  bulk_plain: "本文フッターは付きません。ただしGmail等が差出人名の横に出す配信停止ボタン用のヘッダは付くため、迷惑メール報告に流れにくい状態は保たれます。",
  single: "配信停止フッターは付きません（個別送信は業務連絡として自然な文面で届きます）。広告宣伝が主目的の内容を送るときは、作成画面の「配信停止リンクを本文末尾に付ける」をONにしてください。",
};

/** {var} をハイライトして表示。未知の変数は赤(送信時もそのまま残るため要修正)。 */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{(\w+)\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const known = m[1] in VAR_LABEL;
        return (
          <span
            key={i}
            className={known ? "rounded bg-violet-100 text-violet-700 px-1 font-medium" : "rounded bg-rose-100 text-rose-700 px-1 font-medium"}
            title={known ? `自動で「${VAR_LABEL[m[1]]}」に置き換わります` : "未知の変数: このまま文字として送られます(スペル確認)"}
          >
            {p}
          </span>
        );
      })}
    </>
  );
}

/** 本文中のURLに「計測リンク」バッジを付けて表示。 */
function RenderedBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <span key={i} className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-teal-deep underline break-all">{p}</span>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-light text-teal-deep text-[9px] px-1.5 py-px whitespace-nowrap" title="クリック計測用URLに自動変換されて送られます(誰がいつ押したか記録)">
              <MousePointerClick size={9} /> 計測
            </span>
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function TemplatePreview({ templates, senderVars }: { templates: TplRow[]; senderVars: SenderVars }) {
  const senderName = senderVars.sender;
  const senderEmail = senderVars.sender_email;
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [contact, setContact] = useState("山田 太郎");
  const [company, setCompany] = useState("株式会社サンプル");
  // 配信停止フッターの有無は「送信方法 × 内容が広告宣伝か」で変わるため、プレビューも切り替える
  const [mode, setMode] = useState<PreviewMode>("bulk_ad");
  const withFooter = mode === "bulk_ad";
  const tpl = useMemo(() => templates.find((t) => t.id === tplId) ?? null, [templates, tplId]);
  const vars = {
    contact, company, opportunity: "",
    ...senderVars,
    sender: senderName || "(差出人名未設定)",
    signature: senderVars.signature || "(署名未設定 — メール設定で登録してください)",
  };
  const subject = tpl ? renderEmailTemplate(tpl.subject_tmpl, vars) : "";
  const body = tpl ? renderEmailTemplate(tpl.body_tmpl, vars) : "";

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-ink/50 block">テンプレート</label>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="input min-w-[260px]">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>[{EMAIL_CATEGORY_LABEL[t.category] ?? t.category}] {t.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-ink/50 block">サンプル: 相手の氏名 {"{contact}"}</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} className="input w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-ink/50 block">サンプル: 会社名 {"{company}"}</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="input w-52" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-ink/50 block">送信方法・内容</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as PreviewMode)} className="input w-64">
            {(Object.keys(MODE_LABEL) as PreviewMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </select>
        </div>
        {tpl && (
          <Link href="/app/email/templates" className="btn-ghost inline-flex items-center gap-1.5 text-sm ml-auto">
            <PenSquare size={14} /> このテンプレを編集
          </Link>
        )}
      </div>

      {tpl && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* 左: 設定(テンプレ原文) */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/[0.06] bg-mist-soft/40 flex items-center gap-2">
              <PenSquare size={14} className="text-ink/50" />
              <span className="text-sm font-semibold text-ink">設定画面のテンプレ（原文）</span>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div>
                <p className="text-[11px] text-ink/45 mb-0.5">件名テンプレ</p>
                <p className="rounded-lg border border-black/10 bg-white px-3 py-2"><Highlighted text={tpl.subject_tmpl || "(件名なし)"} /></p>
              </div>
              <div>
                <p className="text-[11px] text-ink/45 mb-0.5">本文テンプレ</p>
                <p className="rounded-lg border border-black/10 bg-white px-3 py-2 whitespace-pre-wrap leading-relaxed"><Highlighted text={tpl.body_tmpl} /></p>
              </div>
              <p className="text-[11px] text-ink/45">
                <span className="rounded bg-violet-100 text-violet-700 px-1">紫</span> = リードごとに自動で置き換わる差し込み変数 ／
                <span className="rounded bg-rose-100 text-rose-700 px-1 ml-1">赤</span> = 未知の変数（そのまま送られるためスペル要確認）
              </p>
            </div>
          </div>

          {/* 右: 実際に届くメール */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/[0.06] bg-teal-light/30 flex items-center gap-2">
              <Eye size={14} className="text-teal-deep" />
              <span className="text-sm font-semibold text-teal-deep">
                実際に届くメール（{contact || "相手"} さんの受信画面 ／ {MODE_LABEL[mode]}）
              </span>
            </div>
            <div className="p-4">
              <div className="rounded-xl border border-black/10 overflow-hidden text-sm">
                <div className="px-4 py-2.5 bg-mist-soft/40 border-b border-black/[0.06] space-y-0.5 text-xs text-ink/60">
                  <p><span className="inline-block w-12 text-ink/40">差出人</span>{senderName || "(差出人名)"} &lt;{senderEmail || "you@example.com"}&gt;</p>
                  <p><span className="inline-block w-12 text-ink/40">宛先</span>{contact} 様</p>
                  <p className="text-ink font-semibold text-sm pt-1">{subject || "(件名なし)"}</p>
                </div>
                <div className="px-4 py-3 whitespace-pre-wrap leading-relaxed bg-white">
                  <RenderedBody text={body} />
                  {withFooter ? (
                    <div className="mt-4 pt-3 border-t border-dashed border-black/15 text-xs text-ink/45">
                      ――――――――――――――――{"\n"}
                      本メールは、名刺交換・展示会・お問い合わせ等で接点をいただいた方にお送りしています。{"\n"}
                      配信停止をご希望の方はこちら: <span className="underline">https://…/api/track/u/（メールごとに固有のURL）</span>
                      <span className="ml-1 rounded-full bg-mist-soft text-ink/50 text-[9px] px-1.5 py-px">自動付与</span>
                    </div>
                  ) : (
                    <div className="mt-4 pt-3 border-t border-dashed border-black/15 text-xs text-ink/40">
                      配信停止フッターは<b>付きません</b>。<span className="block">{MODE_NOTE[mode]}</span>
                    </div>
                  )}
                </div>
                <div className="px-4 py-2 bg-mist-soft/30 border-t border-black/[0.06] text-[11px] text-ink/45">
                  📎 このほか、目に見えない開封計測（1pxの画像）が自動で入ります。開封・クリックはエンゲージメントスコアに加点され、ホット通知の判定に使われます。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {!tpl && <p className="text-sm text-ink/40">テンプレートがまだありません。<Link href="/app/email/templates" className="underline">テンプレート管理</Link>から作成してください。</p>}
    </div>
  );
}
