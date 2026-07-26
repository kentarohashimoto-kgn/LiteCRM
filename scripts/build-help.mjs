/**
 * docs/ONBOARDING.md → public/help/onboarding.html を生成する。
 * ヘルプ画面から読む資料の実体はHTMLだが、原本はMarkdown1つに保つための変換スクリプト。
 * 依存を増やさないため、資料で使っている記法だけを扱う小さな変換器。
 *
 *   実行: node scripts/build-help.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "docs/ONBOARDING.md");
const OUT = resolve(root, "public/help/onboarding.html");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** インライン記法: `code` → **bold** → *italic* → [text](url) の順に適用。 */
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, p, c) => `${p}<em>${c}</em>`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
    // 資料間リンクは配信されるHTMLへ差し替える(./MANUAL.md → ./manual.html)
    let u = url.replace(/\.\/MANUAL\.md/i, "./manual.html").replace(/\.\/ONBOARDING\.md/i, "./onboarding.html");
    const safe = /^(https?:|\.|\/|#)/.test(u) ? u : "#";
    const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${safe}"${ext}>${txt}</a>`;
  });
  return t;
}

const splitRow = (line) =>
  line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function convert(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 表: ヘッダ行 + 区切り行(---) + データ行
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.endsWith(":") && c.startsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"
      );
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(splitRow(lines[i++]));
      out.push(
        `<div class="scroll"><table>` +
          `<thead><tr>${head.map((h, n) => `<th style="text-align:${align[n] ?? "left"}">${inline(h)}</th>`).join("")}</tr></thead>` +
          `<tbody>${body
            .map((r) => `<tr>${r.map((c, n) => `<td style="text-align:${align[n] ?? "left"}">${inline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`
      );
      continue;
    }

    // 見出し
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 水平線
    if (/^---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.filter(Boolean).map((b) => `<p>${inline(b)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // リスト(チェックボックス・番号付き・箇条書き)
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        let txt = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        const box = txt.match(/^\[( |x|X)\]\s*/);
        let cls = "";
        if (box) { txt = txt.slice(box[0].length); cls = ' class="check"'; }
        items.push(`<li${cls}>${inline(txt)}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    // 段落
    if (line.trim() === "") { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|>\s?|\s*\||---+\s*$|\s*(?:[-*]|\d+\.)\s)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const STYLE = `
:root{--ink:#273A3A;--mut:rgba(39,58,58,.68);--line:rgba(39,58,58,.12);--soft:rgba(39,58,58,.06);
--teal:#008C8C;--deep:#006C6A;--light:#DDF3F0;--accent:#F59A2A;--bg:#F4F6F6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.85;
font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",Meiryo,system-ui,sans-serif;
font-feature-settings:"palt";-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;background:#fff;padding:0 0 80px;min-height:100vh;
box-shadow:0 0 40px rgba(39,58,58,.06)}
header{background:linear-gradient(135deg,var(--teal),var(--deep));color:#fff;padding:44px 48px 34px}
header h1{margin:0;font-size:26px;letter-spacing:-.01em}
header p{margin:10px 0 0;font-size:14px;opacity:.93}
main{padding:10px 48px}
h1{font-size:25px;letter-spacing:-.01em;margin:38px 0 10px}
h2{font-size:20px;margin:38px 0 10px;padding-bottom:8px;border-bottom:2px solid var(--light);color:var(--deep)}
h3{font-size:16px;margin:26px 0 8px}
h4{font-size:14px;margin:20px 0 6px;color:var(--mut)}
p{margin:10px 0}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}
ul,ol{margin:10px 0;padding-left:24px}
li{margin:5px 0}
li.check{list-style:none;position:relative}
li.check::before{content:"";position:absolute;left:-20px;top:.5em;width:11px;height:11px;
border:1.5px solid var(--teal);border-radius:3px}
code{background:var(--light);color:var(--deep);padding:1px 6px;border-radius:5px;font-size:.9em;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
blockquote{margin:16px 0;padding:12px 18px;background:#FFF8EE;border-left:4px solid var(--accent);border-radius:0 8px 8px 0}
blockquote p{margin:4px 0;font-size:14px;color:#6b4a12}
.scroll{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:420px}
th{background:var(--light);color:var(--deep);font-weight:700;padding:9px 12px;border:1px solid var(--line);white-space:nowrap}
td{padding:9px 12px;border:1px solid var(--line);vertical-align:top;color:var(--mut)}
tr:nth-child(even) td{background:#FAFBFB}
a{color:var(--deep)}
strong{color:var(--ink)}
@media(max-width:640px){header,main{padding-left:22px;padding-right:22px}}
@media print{body{background:#fff}.wrap{box-shadow:none;max-width:none}}
`;

mkdirSync(dirname(OUT), { recursive: true });
const md = readFileSync(SRC, "utf8");
// 先頭のタイトル行はヘッダーに出すので本文からは除く
const bodyMd = md.replace(/^#\s+.*\n/, "");
writeFileSync(
  OUT,
  `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CATORCE Sales OS オンボーディング資料</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>CATORCE Sales OS オンボーディング資料</h1>
<p>背景・目的・活用法・運用ルール ／ 新しく参加する営業担当・バックオフィス担当の方へ</p>
</header>
<main>
${convert(bodyMd)}
</main>
</div>
</body>
</html>
`,
  "utf8"
);
console.log(`built: ${OUT}`);
