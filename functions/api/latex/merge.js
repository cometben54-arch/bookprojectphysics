import { json, error, authorize } from "../../_shared.js";

// Server-side LaTeX merge (mirrors the client-side merger).
// Body: { files: [{name, content}], template: {...}, options:{title,author,headingLevel} }

function buildPreamble(tpl) {
  const docClass = tpl.docClass || "ctexbook";
  const opts = tpl.opts || "UTF8,a4paper,11pt,oneside";
  const pkgs = (tpl.pkgs || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = [`\\documentclass[${opts}]{${docClass}}`];
  for (const p of pkgs) lines.push(`\\usepackage{${p}}`);
  if (tpl.font) lines.push(`% main font: ${tpl.font}`);
  lines.push("\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue}");
  if (tpl.theorems) lines.push(tpl.theorems.trim());
  if (tpl.extra) lines.push(tpl.extra.trim());
  return lines.join("\n");
}

function stripBody(t) {
  const m = t.match(/\\begin\s*\{\s*document\s*\}([\s\S]*?)\\end\s*\{\s*document\s*\}/);
  if (m) return m[1].trim();
  const m2 = t.match(/\\documentclass[\s\S]*?\\begin\s*\{\s*document\s*\}([\s\S]*)$/);
  if (m2) return m2[1].replace(/\\end\s*\{\s*document\s*\}[\s\S]*$/, "").trim();
  return t.trim();
}

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const body = await request.json().catch(() => ({}));
  const files = body.files || [];
  const tpl = body.template || {};
  const opts = body.options || {};

  const out = [];
  out.push(buildPreamble(tpl));
  out.push("\\begin{document}");
  if (opts.title) {
    out.push(`\\title{${opts.title}}`);
    out.push(`\\author{${opts.author || ""}}`);
    out.push("\\date{\\today}");
    out.push("\\maketitle");
    out.push("\\tableofcontents");
  }
  for (const f of files) {
    const inner = stripBody(f.content || "");
    const base = (f.name || "section").replace(/\.[^.]+$/, "");
    if (!/^\s*\\chapter\b/.test(inner)) {
      out.push(`\\${opts.headingLevel || "chapter"}{${base}}`);
    }
    out.push(inner);
    out.push("");
  }
  out.push("\\end{document}");
  return json({ content: out.join("\n") });
};
