// PDF -> Chinese book translation/rewrite pipeline.
//
// Pipeline:
//   1. User picks a (potentially large) PDF.
//   2. pdf.js extracts text page-by-page in the browser.
//   3. The text is chunked into "chapters": detected chapter headings if
//      possible, otherwise fixed-size character windows at paragraph breaks.
//   4. Per batch (default 1 chunk), we call the AI to translate + format the
//      chunk into a LaTeX section ([[TITLE]] [[KNOWLEDGE]] [[EXAMPLES]]
//      [[EXERCISES]] markers, reusing the same parser as the writer tab).
//      Each finished chunk is appended to project.sections.
//   5. After every batch we pause for user review unless auto-mode is on.

(function (global) {
  const PDFJS_VER = "3.11.174";
  // Try multiple CDNs in order. cdnjs is on Cloudflare's network (same as
  // this site, and reachable from mainland China where jsdelivr is flaky).
  // Each entry is a {lib, worker} pair; whichever one successfully exposes
  // window.pdfjsLib wins, and its worker URL is used.
  const PDFJS_SOURCES = [
    {
      lib:
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" +
        PDFJS_VER +
        "/pdf.min.js",
      worker:
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" +
        PDFJS_VER +
        "/pdf.worker.min.js",
    },
    {
      lib:
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.min.js",
      worker:
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.worker.min.js",
    },
    {
      lib:
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.js",
      worker:
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.worker.js",
    },
    {
      lib:
        "https://unpkg.com/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.min.js",
      worker:
        "https://unpkg.com/pdfjs-dist@" +
        PDFJS_VER +
        "/legacy/build/pdf.worker.min.js",
    },
  ];

  function loadScript(url) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => res();
      s.onerror = () => rej(new Error("加载失败"));
      document.head.appendChild(s);
    });
  }

  let loading = null;
  function ensurePdfJs() {
    if (global.pdfjsLib && global.pdfjsLib.getDocument)
      return Promise.resolve(global.pdfjsLib);
    if (loading) return loading;
    loading = (async () => {
      const errs = [];
      for (const src of PDFJS_SOURCES) {
        try {
          await loadScript(src.lib);
          if (global.pdfjsLib && global.pdfjsLib.getDocument) {
            global.pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
            return global.pdfjsLib;
          }
          errs.push(src.lib + "（已加载但未暴露 pdfjsLib）");
        } catch {
          errs.push(src.lib + "（网络/404）");
        }
      }
      loading = null; // allow a later retry
      throw new Error(
        "无法加载 pdf.js，已尝试 " +
          PDFJS_SOURCES.length +
          " 个 CDN 均失败：\n" +
          errs.join("\n") +
          "\n（可能是网络被拦截，或公司网络屏蔽了 CDN）"
      );
    })();
    return loading;
  }

  async function extractPdfText(file, onProgress) {
    const lib = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    let doc;
    try {
      doc = await lib.getDocument({ data: buf }).promise;
    } catch (e) {
      throw new Error(
        "PDF 打开失败：" +
          (e && e.message ? e.message : e) +
          "（可能是加密 PDF、文件损坏，或不是有效的 PDF）"
      );
    }
    const pages = [];
    let totalChars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      // Heuristic: join items by space, insert newline when y-position changes.
      let lastY = null;
      let line = [];
      const lines = [];
      for (const it of tc.items) {
        const y = it.transform ? it.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          if (line.length) lines.push(line.join(" "));
          line = [];
        }
        line.push(it.str);
        lastY = y;
      }
      if (line.length) lines.push(line.join(" "));
      const pageText = lines.join("\n");
      totalChars += pageText.replace(/\s/g, "").length;
      pages.push(pageText);
      if (onProgress) onProgress(i, doc.numPages);
    }
    if (totalChars < 20) {
      throw new Error(
        "未能从该 PDF 提取到文字（共 " +
          doc.numPages +
          " 页，提取到 " +
          totalChars +
          " 个非空白字符）。" +
          "该 PDF 很可能是扫描版 —— 每页是图片、没有文字层，需要先做 OCR 才能翻译。"
      );
    }
    return { pages, numPages: doc.numPages };
  }

  // Try to detect chapter boundaries. Returns array of {title, text} or null
  // if detection didn't yield enough markers.
  function chunkByChapter(fullText) {
    const lines = fullText.split("\n");
    const re =
      /^(?:CHAPTER|Chapter|chapter|第\s*[一二三四五六七八九十百零\d]{1,4}\s*章|PART|Part)\s*[\dIVXLCM一二三四五六七八九十]*/;
    const marks = [];
    for (let i = 0; i < lines.length; i++) {
      const t = (lines[i] || "").trim();
      if (re.test(t) && t.length < 120) {
        marks.push({ line: i, title: t });
      }
    }
    if (marks.length < 2) return null;
    const chunks = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].line;
      const end = i + 1 < marks.length ? marks[i + 1].line : lines.length;
      const body = lines.slice(start + 1, end).join("\n").trim();
      if (body.length < 200) continue; // skip tiny TOC entries / dedupes
      chunks.push({ title: marks[i].title, text: body });
    }
    return chunks.length >= 2 ? chunks : null;
  }

  function chunkByLength(fullText, targetChars = 8000) {
    const paras = fullText.split(/\n\s*\n/);
    const chunks = [];
    let buf = "";
    let i = 1;
    for (const p of paras) {
      if (buf.length + p.length + 2 > targetChars && buf.length) {
        chunks.push({ title: "Chunk " + i++, text: buf.trim() });
        buf = "";
      }
      buf += p + "\n\n";
    }
    if (buf.trim()) chunks.push({ title: "Chunk " + i, text: buf.trim() });
    return chunks;
  }

  function chunkText(fullText, opts = {}) {
    if (opts.strategy === "length") return chunkByLength(fullText, opts.target);
    const byChap = chunkByChapter(fullText);
    if (byChap) return byChap;
    return chunkByLength(fullText, opts.target || 8000);
  }

  // ---------- batch runner ----------
  function makeJob(chunks, opts) {
    return {
      chunks: chunks.map((c, i) => ({
        id: "c" + i,
        title: c.title,
        text: c.text,
        status: "pending", // pending | running | done | error | skipped
        sectionIdx: -1,
        output: "",
        error: "",
      })),
      cursor: 0,
      batchSize: opts.batchSize || 1,
      autoMode: !!opts.autoMode,
      style: opts.style || "rewrite",
      provider: opts.provider || "",
      running: false,
      abort: false,
      onUpdate: opts.onUpdate || (() => {}),
      onChunkDone: opts.onChunkDone || (() => {}),
      onBatchPause: opts.onBatchPause || (() => {}),
      onFinish: opts.onFinish || (() => {}),
    };
  }

  const PROMPT_REWRITE =
    `你是物理英文教材的中文翻译与教辅改写专家。任务：把给定的英文章节翻译成中文，并整理为可直接插入中文物理教辅的 LaTeX 片段。
要求：
- 公式必须保留并用 amsmath / physics 风格（\\[ ... \\] 或 align）
- 概念按主流中文物理教材译法
- 例题用 \\begin{example}...\\end{example}；解用 \\begin{solution}...\\end{solution}；习题用 \\begin{exercise}...\\end{exercise}
- 不要输出 \\documentclass / \\begin{document}
- 严格按以下机器可读分节标记输出（不要任何前言或多余说明）：

[[TITLE]]
本节中文标题（一行）
[[KNOWLEDGE]]
... 中文译文与必要的术语澄清 ...
[[EXAMPLES]]
... 原文中的例题（如有），译成中文，每题用 \\begin{example}...\\end{example} 包裹，解用 \\begin{solution}...\\end{solution}；多题用 %%EX%% 分隔 ...
[[EXERCISES]]
... 原文中的习题/课后题，译成中文，环境同上，多题用 %%EX%% 分隔 ...`;

  const PROMPT_TRANSLATE =
    `你是严谨的物理学术翻译。把给定英文章节忠实译成中文，保持原结构与公式 LaTeX 形式。输出格式：

[[TITLE]]
本节中文标题（一行；如原文未给章节标题，自行拟一个简洁标题）
[[KNOWLEDGE]]
... 中文译文 ...
[[EXAMPLES]]
（如原文有 Example 段落，搬入此处并译；用 \\begin{example} 包裹；多题 %%EX%% 分隔；否则留空）
[[EXERCISES]]
（如原文有习题，搬入并译；多题 %%EX%% 分隔；否则留空）

不要输出 \\documentclass / \\begin{document}，不要任何前言或解释。`;

  async function translateChunk(job, chunk) {
    const sys = job.style === "translate" ? PROMPT_TRANSLATE : PROMPT_REWRITE;
    const user =
      "章节标题（原文）：" +
      chunk.title +
      "\n\n章节正文（原文）：\n" +
      chunk.text;
    const r = await global.BPPX.ai.generate({
      provider: job.provider,
      system: sys,
      user,
      max_tokens: 0,
      temperature: 0.2,
    });
    return (r && r.content) || "";
  }

  // Parse LLM output into a section object. Mirrors writer.applyGenResult
  // but stand-alone here so we don't reach into app.js internals.
  function parseToSection(output, fallbackTitle) {
    const pick = (tag) => {
      const re = new RegExp(
        "\\[\\[" + tag + "\\]\\]([\\s\\S]*?)(?=\\[\\[[A-Z]+\\]\\]|$)"
      );
      const m = output.match(re);
      return m ? m[1].trim() : "";
    };
    const titleRaw = pick("TITLE");
    const knowledge = pick("KNOWLEDGE");
    const examplesBlob = pick("EXAMPLES");
    const exercisesBlob = pick("EXERCISES");
    const parseBlocks = (blob, envName, ansKey) => {
      if (!blob) return [];
      return blob
        .split(/%%EX%%/)
        .map((c) => {
          const qm = c.match(
            new RegExp(
              "\\\\begin\\s*\\{" + envName + "\\}([\\s\\S]*?)\\\\end\\s*\\{" + envName + "\\}"
            )
          );
          const sm = c.match(
            /\\begin\s*\{solution\}([\s\S]*?)\\end\s*\{solution\}/
          );
          const o = { q: qm ? qm[1].trim() : c.trim() };
          o[ansKey] = sm ? sm[1].trim() : "";
          return o;
        })
        .filter((x) => x.q);
    };
    let title = titleRaw || fallbackTitle || "";
    title = title.replace(/^[#\s]+/, "").trim();
    const sec = {
      title,
      knowledge: knowledge || (titleRaw ? "" : output.trim()),
      examples: parseBlocks(examplesBlob, "example", "sol"),
      exercises: parseBlocks(exercisesBlob, "exercise", "a"),
      images: [],
    };
    return sec;
  }

  async function runOne(job, attachSection) {
    const c = job.chunks[job.cursor];
    if (!c) return;
    c.status = "running";
    job.onUpdate(job);
    try {
      const output = await translateChunk(job, c);
      c.output = output;
      const sec = parseToSection(output, c.title);
      attachSection(sec);
      c.sectionIdx = -1; // caller fills this if it cares
      c.status = "done";
      job.onChunkDone(job, c);
    } catch (e) {
      c.status = "error";
      c.error = e.message || String(e);
      job.onUpdate(job);
      throw e;
    }
    job.cursor++;
    job.onUpdate(job);
  }

  async function run(job, attachSection) {
    if (job.running) return;
    job.running = true;
    job.abort = false;
    try {
      while (job.cursor < job.chunks.length && !job.abort) {
        const batchEnd = Math.min(
          job.cursor + job.batchSize,
          job.chunks.length
        );
        while (job.cursor < batchEnd && !job.abort) {
          try {
            await runOne(job, attachSection);
          } catch {
            job.abort = true;
            break;
          }
        }
        if (job.abort) break;
        if (job.cursor >= job.chunks.length) break;
        if (!job.autoMode) {
          job.running = false;
          job.onBatchPause(job);
          return;
        }
      }
    } finally {
      job.running = false;
      if (job.cursor >= job.chunks.length || job.abort) job.onFinish(job);
    }
  }

  function setAutoMode(job, on) {
    job.autoMode = !!on;
    job.onUpdate(job);
  }
  function pause(job) {
    job.abort = true;
  }

  global.BPPX = global.BPPX || {};
  global.BPPX.pdfTranslate = {
    ensurePdfJs,
    extractPdfText,
    chunkText,
    chunkByChapter,
    chunkByLength,
    makeJob,
    run,
    pause,
    setAutoMode,
    parseToSection,
  };
})(window);
