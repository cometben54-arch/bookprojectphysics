// LaTeX preamble builder + multi-file merger (browser-side).

(function (global) {
  function buildPreamble(tpl) {
    const docClass = tpl.docClass || "ctexbook";
    const opts = tpl.opts || "UTF8,a4paper,11pt,oneside";
    const pkgs = (tpl.pkgs || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const lines = [];
    lines.push(`\\documentclass[${opts}]{${docClass}}`);
    for (const p of pkgs) lines.push(`\\usepackage{${p}}`);
    if (tpl.font && /xeCJK|ctex/i.test(docClass + " " + pkgs.join(","))) {
      lines.push(`\\setmainfont{${tpl.font}}`);
    } else if (tpl.font) {
      lines.push(`% main font: ${tpl.font}`);
    }
    lines.push("\\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue}");
    if (tpl.theorems) lines.push(tpl.theorems.trim());
    if (tpl.extra) lines.push(tpl.extra.trim());
    return lines.join("\n");
  }

  function buildFull(project) {
    const tpl = project.template;
    const pre = buildPreamble(tpl);
    const title = (project.title || "").replace(/[{}]/g, "");
    const author = (project.author || "").replace(/[{}]/g, "");
    const body = buildBody(project);
    return [
      pre,
      `\\title{${title}}`,
      `\\author{${author}}`,
      `\\date{\\today}`,
      "\\begin{document}",
      "\\maketitle",
      "\\tableofcontents",
      body,
      "\\end{document}",
      "",
    ].join("\n");
  }

  function buildBody(project) {
    const out = [];
    // Group sections by their "chapter / section" split if outline used "/".
    // Section.title format expected: "第X章 名/小节名"
    let lastChap = null;
    for (const s of project.sections) {
      const t = (s.title || "").trim();
      let chap = null,
        sec = t;
      if (t.includes("/")) {
        const i = t.indexOf("/");
        chap = t.slice(0, i).trim();
        sec = t.slice(i + 1).trim();
      }
      if (chap && chap !== lastChap) {
        out.push("");
        out.push(`\\chapter{${chap}}`);
        lastChap = chap;
      }
      out.push(`\\section{${sec || "（无标题）"}}`);
      if (s.knowledge && s.knowledge.trim()) out.push(s.knowledge.trim());
      for (const ex of s.examples || []) {
        out.push("\\begin{example}");
        out.push((ex.q || "").trim());
        out.push("\\end{example}");
        if (ex.sol && ex.sol.trim()) {
          out.push("\\begin{solution}");
          out.push(ex.sol.trim());
          out.push("\\end{solution}");
        }
      }
      for (const ex of s.exercises || []) {
        out.push("\\begin{exercise}");
        out.push((ex.q || "").trim());
        out.push("\\end{exercise}");
        if (ex.a && ex.a.trim()) {
          out.push("\\begin{solution}");
          out.push(ex.a.trim());
          out.push("\\end{solution}");
        }
      }
    }
    return out.join("\n");
  }

  function buildBodyOnly(project) {
    return buildBody(project);
  }

  // Single-item export: 单题
  function buildSingle(project, sectionIdx, itemKey) {
    const s = project.sections[sectionIdx];
    if (!s) return "% 章节不存在";
    const [kind, idxStr] = itemKey.split(":");
    const idx = Number(idxStr);
    if (kind === "example") {
      const ex = (s.examples || [])[idx];
      if (!ex) return "% 例题不存在";
      return [
        "\\begin{example}",
        (ex.q || "").trim(),
        "\\end{example}",
        "\\begin{solution}",
        (ex.sol || "").trim(),
        "\\end{solution}",
      ].join("\n");
    }
    if (kind === "exercise") {
      const ex = (s.exercises || [])[idx];
      if (!ex) return "% 习题不存在";
      return [
        "\\begin{exercise}",
        (ex.q || "").trim(),
        "\\end{exercise}",
        "\\begin{solution}",
        (ex.a || "").trim(),
        "\\end{solution}",
      ].join("\n");
    }
    return "% 未知项";
  }

  // Strip another file's preamble and keep only what's between
  // \begin{document} ... \end{document}. If those markers are missing,
  // assume the whole file is body content.
  function stripBody(tex) {
    const m = tex.match(/\\begin\s*\{\s*document\s*\}([\s\S]*?)\\end\s*\{\s*document\s*\}/);
    if (m) return m[1].trim();
    // Otherwise strip a leading \documentclass...\begin{document} if any
    const m2 = tex.match(/\\documentclass[\s\S]*?\\begin\s*\{\s*document\s*\}([\s\S]*)$/);
    if (m2) return m2[1].replace(/\\end\s*\{\s*document\s*\}[\s\S]*$/, "").trim();
    return tex.trim();
  }

  // Merge: take an array of {name, content} (raw .tex), produce a single
  // compilable .tex using `tpl` as preamble, and add \part{filename} or
  // \chapter{filename} before each.
  function mergeFiles(files, tpl, opts = {}) {
    const pre = buildPreamble(tpl);
    const parts = [];
    parts.push(pre);
    parts.push("\\begin{document}");
    if (opts.title) parts.push(`\\title{${opts.title}}`);
    if (opts.author) parts.push(`\\author{${opts.author}}`);
    if (opts.title) {
      parts.push("\\date{\\today}");
      parts.push("\\maketitle");
      parts.push("\\tableofcontents");
    }
    for (const f of files) {
      const body = stripBody(f.content);
      const heading = opts.headingLevel || "chapter";
      const base = (f.name || "section").replace(/\.[^.]+$/, "");
      // Only insert auto-heading if the body itself doesn't start with \chapter
      const hasChap = /^\s*\\chapter\b/.test(body);
      if (!hasChap) parts.push(`\\${heading}{${base}}`);
      parts.push(body);
      parts.push("");
    }
    parts.push("\\end{document}");
    return parts.join("\n");
  }

  global.BPPX = global.BPPX || {};
  global.BPPX.latex = {
    buildPreamble,
    buildFull,
    buildBodyOnly,
    buildSingle,
    stripBody,
    mergeFiles,
  };
})(window);
