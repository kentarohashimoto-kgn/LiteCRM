"use client";

import { useState } from "react";
import { Sparkles, ExternalLink, Loader2 } from "lucide-react";
import { askAssistantAction, type AssistantSource } from "@/server/actions/assistant";

const SUGGESTIONS = [
  "この製品の導入手順を教えて",
  "過去の提案書で使っている料金の見せ方は？",
  "研修サービスの特徴を3つにまとめて",
];

/**
 * P4 AIヘルプ。社内資料(CRMに紐付いた資料+601資料庫)を根拠にAIが回答する。
 * 出典は必ずドライブの原本へのリンクとして表示し、鮮度はユーザーが原本で確認できるようにする。
 */
export function AssistantPanel({ categories }: { categories: string[] }) {
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AssistantSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    const res = await askAssistantAction({ question: q, categories: category ? [category] : undefined });
    if (!res.ok) setError(res.error ?? "エラーが発生しました");
    else {
      setAnswer(res.answer ?? "");
      setSources(res.sources ?? []);
    }
    setLoading(false);
  }

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="flex items-start gap-2 flex-wrap mb-3"
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ask(question); } }}
          rows={2}
          placeholder="社内資料について質問してください（⌘+Enterで送信）"
          className="input flex-1 min-w-[260px] resize-y"
        />
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-black/10 px-2.5 py-1.5 text-sm">
            <option value="">すべての資料</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="submit" disabled={loading || question.trim().length < 3} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {loading ? "調べています…" : "質問する"}
          </button>
        </div>
      </form>

      {!answer && !loading && !error && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setQuestion(s); ask(s); }} className="rounded-full border border-black/10 px-3 py-1 text-xs text-ink/60 hover:bg-black/[0.03]">
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}

      {answer && (
        <div className="rounded-xl border border-black/[0.06] p-4">
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</div>
          {sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-black/[0.06]">
              <div className="text-xs text-ink/45 mb-2">出典（クリックでドライブの原本を開きます）</div>
              <ul className="space-y-1.5">
                {sources.map((s, i) => (
                  <li key={s.documentId} className="text-sm flex items-center gap-2">
                    <span className="text-xs text-ink/40 shrink-0">資料{i + 1}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-teal-deep hover:underline inline-flex items-center gap-1 truncate">
                        {s.title} <ExternalLink size={12} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate">{s.title}</span>
                    )}
                    {s.category && <span className="shrink-0 rounded-full bg-teal-light px-2 py-0.5 text-[11px] text-teal-deep">{s.category}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
