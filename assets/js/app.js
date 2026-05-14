// Main page application logic.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = window.BPPX.storage;
  const ai = window.BPPX.ai;
  const tex = window.BPPX.latex;

  // ----- state -----
  let project = store.emptyProject();
  let projectId = store.lastProjectId();
  let genAbort = null;
  let imgModalCtx = null; // { sectionIdx, blob }

  function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show " + kind;
    setTimeout(() => (t.className = "toast"), 2600);
  }

  // Resolve which provider to use for a given role. Falls back to the first
  // configured provider when the explicit default hasn't been set, so users
  // don't HAVE to visit the 默认调用 section before generating anything.
  function resolveProvider(role) {
    const s = store.loadSettings();
    const providers = s.providers || [];
    const first = providers[0] && providers[0].name;
    if (role === "write") return s.write || first || "";
    if (role === "parse") return s.parse || s.write || first || "";
    if (role === "image") return s.image || first || "";
    return s.write || first || "";
  }
  // Proofread can use several providers; fall back to all configured ones.
  function resolveProofProviders() {
    const s = store.loadSettings();
    const chosen = (s.proof || []).filter(Boolean);
    if (chosen.length) return chosen;
    return (s.providers || []).map((p) => p.name).filter(Boolean);
  }

  // Pull global settings (providers + defaults) from the server so a fresh
  // browser — or one where only the settings page was used — still knows
  // about configured providers. Best-effort; localStorage is the fallback.
  async function bootstrapSettingsFromRemote() {
    try {
      const local = store.loadSettings();
      const headers = local.shareToken
        ? { "x-share-token": local.shareToken }
        : {};
      const r = await fetch("/api/store/settings", { headers });
      if (!r.ok) return;
      const remote = await r.json();
      if (!remote || !remote.providers) return;
      const merged = { ...local, ...remote };
      // Keep a local API key if the remote one is blank for the same name.
      const localByName = Object.fromEntries(
        (local.providers || []).map((p) => [p.name, p])
      );
      merged.providers = (remote.providers || []).map((p) => {
        if (!p.key && localByName[p.name]) p.key = localByName[p.name].key;
        return p;
      });
      store.saveSettings(merged);
    } catch {
      // offline / no KV — fine, localStorage stands
    }
  }

  // ----- tab switching -----
  $$(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".panel").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $(`.panel[data-panel="${b.dataset.tab}"]`).classList.add("active");
      if (b.dataset.tab === "template") renderTemplate();
      if (b.dataset.tab === "proof") refreshProofSection();
      if (b.dataset.tab === "export") refreshExportPickers();
    })
  );

  // ----- reference tabs -----
  $$(".ref-tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".ref-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const k = b.dataset.ref;
      $("#refText").style.display = k === "text" ? "" : "none";
      $("#refPdf").style.display = k === "pdf" ? "" : "none";
      $("#refUrl").style.display = k === "url" ? "" : "none";
    })
  );

  // ----- project I/O -----
  if (projectId) $("#projectId").value = projectId;

  $("#loadProject").addEventListener("click", async () => {
    const id = $("#projectId").value.trim();
    if (!id) return toast("请输入项目 ID", "err");
    projectId = id;
    const settings = store.loadSettings();
    const localP = store.loadLocalProject(id);
    let remoteP = null;
    try {
      remoteP = await store.fetchRemoteProject(id, settings.shareToken);
    } catch (e) {
      toast("远端加载失败：" + e.message + "（仅使用本地）", "err");
    }
    const merged = store.pickNewer(remoteP, localP);
    if (!merged) {
      project = store.emptyProject();
      toast("新建项目：" + id, "ok");
    } else {
      project = { ...store.emptyProject(), ...merged };
      toast("已载入：" + id, "ok");
    }
    bindToUI();
  });

  $("#saveProject").addEventListener("click", async () => {
    const id = $("#projectId").value.trim();
    if (!id) return toast("请输入项目 ID", "err");
    projectId = id;
    pullFromUI();
    store.saveLocalProject(id, project);
    const settings = store.loadSettings();
    try {
      await store.pushRemoteProject(id, settings.shareToken, project);
      toast("已保存（本地+云端）", "ok");
    } catch (e) {
      toast("已保存本地。云端失败：" + e.message, "err");
    }
  });

  function bindToUI() {
    $("#bookTitle").value = project.title || "";
    $("#bookAuthor").value = project.author || "";
    $("#bookLevel").value = project.level || "高中";
    $("#bookOutline").value = project.outline || "";
    $("#refText").value = project.refText || "";
    $("#refSummary").value = project.refSummary || "";

    const t = project.template;
    $("#tplDocClass").value = t.docClass;
    $("#tplOpts").value = t.opts;
    $("#tplFont").value = t.font;
    $("#tplPkgs").value = t.pkgs;
    $("#tplTheorems").value = t.theorems;
    $("#tplExtra").value = t.extra;

    renderSections();
    renderTemplate();
    refreshProofSection();
    refreshExportPickers();
    if (typeof bindPdfFromProject === "function") bindPdfFromProject();
  }

  function pullFromUI() {
    project.title = $("#bookTitle").value;
    project.author = $("#bookAuthor").value;
    project.level = $("#bookLevel").value;
    project.outline = $("#bookOutline").value;
    project.refText = $("#refText").value;
    project.refSummary = $("#refSummary").value;
    Object.assign(project.template, {
      docClass: $("#tplDocClass").value,
      opts: $("#tplOpts").value,
      font: $("#tplFont").value,
      pkgs: $("#tplPkgs").value,
      theorems: $("#tplTheorems").value,
      extra: $("#tplExtra").value,
    });
    // Sections are pulled live by inputs themselves.
  }

  // ----- reference parsing -----
  $("#parseRef").addEventListener("click", async () => {
    const status = $("#parseStatus");
    const active = $(".ref-tab.active").dataset.ref;
    let kind = active,
      payload;
    if (active === "text") payload = $("#refText").value.trim();
    else if (active === "url") payload = $("#refUrl").value.trim();
    else if (active === "pdf") {
      const f = $("#refPdf").files[0];
      if (!f) return toast("请先选择 PDF 文件", "err");
      payload = await fileToBase64(f);
    }
    if (!payload) return toast("参考内容为空", "err");

    const provider = resolveProvider("parse");
    if (!provider)
      return toast("还没有配置任何 AI 提供商，请点右上角 ⚙ 添加", "err");
    status.textContent = "AI 解析中...";
    try {
      const res = await ai.parseRef({ provider, kind, payload });
      $("#refSummary").value = res.content || JSON.stringify(res, null, 2);
      status.textContent = "✓ 解析完成";
      pullFromUI();
    } catch (e) {
      status.textContent = "✗ " + e.message;
      toast("解析失败：" + e.message, "err");
    }
  });

  function fileToBase64(f) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] || "");
      fr.onerror = rej;
      fr.readAsDataURL(f);
    });
  }

  // ----- section rendering & manipulation -----
  function renderSections() {
    const list = $("#sectionList");
    list.innerHTML = "";
    (project.sections || []).forEach((s, i) => list.appendChild(sectionEl(s, i)));
  }
  function sectionEl(s, idx) {
    const root = document.createElement("div");
    root.className = "section-item";
    root.innerHTML = `
      <div class="section-head">
        <input class="s-title" value="${escapeHtml(s.title || "")}" placeholder="第X章 名/小节名" />
        <span class="section-meta">#${idx + 1}</span>
        <div class="section-actions">
          <button class="btn s-regen">重生成</button>
          <button class="btn s-up">↑</button>
          <button class="btn s-down">↓</button>
          <button class="btn s-toggle">折叠</button>
          <button class="btn btn-danger s-del">删除</button>
        </div>
      </div>
      <div class="section-body">
        <label>知识讲解
          <textarea class="s-know" rows="6">${escapeHtml(s.knowledge || "")}</textarea>
        </label>
        <label>例题（每个例题块：题干 / 解 各一段，多题用 <hr> 分隔的标记 <code>%%EX%%</code> 切分）
          <textarea class="s-ex" rows="8">${escapeHtml(serializeQA(s.examples, "sol"))}</textarea>
        </label>
        <label>习题（同上，分隔标记 <code>%%EX%%</code>，每题 题/答 两段）
          <textarea class="s-exc" rows="8">${escapeHtml(serializeQA(s.exercises, "a"))}</textarea>
        </label>
        <div class="img-area">
          <div class="row">
            <strong>插图</strong>
            <button class="btn s-upload">上传图片</button>
            <button class="btn s-aigen">AI 文生图</button>
            <span class="muted small">上传任意格式（JPG/WEBP/SVG/...），自动转 PNG。点击插图可插入或替换。</span>
          </div>
          <div class="img-grid"></div>
          <input type="file" class="s-upload-file" accept="image/*" hidden />
        </div>
      </div>`;
    const set = (sel, fn) =>
      root.querySelector(sel).addEventListener("input", () => {
        fn();
        // No autosave — user clicks 保存 explicitly.
      });
    set(".s-title", () => (s.title = root.querySelector(".s-title").value));
    set(".s-know", () => (s.knowledge = root.querySelector(".s-know").value));
    set(".s-ex", () =>
      (s.examples = deserializeQA(root.querySelector(".s-ex").value, "sol"))
    );
    set(".s-exc", () =>
      (s.exercises = deserializeQA(root.querySelector(".s-exc").value, "a"))
    );
    root.querySelector(".s-del").addEventListener("click", () => {
      if (!confirm("删除本节？")) return;
      project.sections.splice(idx, 1);
      renderSections();
    });
    root.querySelector(".s-up").addEventListener("click", () => {
      if (idx === 0) return;
      const [m] = project.sections.splice(idx, 1);
      project.sections.splice(idx - 1, 0, m);
      renderSections();
    });
    root.querySelector(".s-down").addEventListener("click", () => {
      if (idx >= project.sections.length - 1) return;
      const [m] = project.sections.splice(idx, 1);
      project.sections.splice(idx + 1, 0, m);
      renderSections();
    });
    root.querySelector(".s-toggle").addEventListener("click", () =>
      root.classList.toggle("collapsed")
    );
    root.querySelector(".s-regen").addEventListener("click", () =>
      generateSection(idx)
    );
    // Image area
    s.images = s.images || [];
    const grid = root.querySelector(".img-grid");
    const fileIn = root.querySelector(".s-upload-file");
    function renderGrid() {
      grid.innerHTML = "";
      s.images.forEach((meta, mi) => grid.appendChild(imgTile(s, mi)));
    }
    root.querySelector(".s-upload").addEventListener("click", () =>
      fileIn.click()
    );
    fileIn.addEventListener("change", async () => {
      for (const f of fileIn.files) {
        try {
          await uploadAndRegister(s, f);
        } catch (e) {
          toast("上传失败：" + e.message, "err");
        }
      }
      fileIn.value = "";
      renderGrid();
    });
    root.querySelector(".s-aigen").addEventListener("click", () =>
      openImgModal(idx)
    );
    renderGrid();
    return root;
  }

  // ----- image helpers (hooked from sectionEl) -----
  async function uploadAndRegister(section, fileOrBlob, opts = {}) {
    if (!projectId)
      throw new Error("先在右上输入项目 ID 并保存一次再上传图片");
    const id = opts.id || window.BPPX.images.newId();
    const png = await window.BPPX.images.fileToPng(fileOrBlob);
    const meta = {
      name: opts.name || fileOrBlob.name || id + ".png",
      caption: opts.caption || "",
      width: png.width,
      height: png.height,
    };
    await window.BPPX.images.uploadPng(projectId, id, png.blob, meta);
    section.images = section.images || [];
    // Replace if id already present (used for "替换" flow).
    const existing = section.images.findIndex((x) => x.id === id);
    const rec = { id, ...meta };
    if (existing >= 0) section.images[existing] = rec;
    else section.images.push(rec);
    return rec;
  }

  function imgTile(section, mi) {
    const meta = section.images[mi];
    const div = document.createElement("div");
    div.className = "img-tile";
    div.innerHTML = `
      <div class="img-thumb"><img alt="" /></div>
      <input class="img-cap" value="${escapeHtml(meta.caption || "")}" placeholder="说明（可选）" />
      <div class="row">
        <button class="btn img-ins-know">→讲解</button>
        <button class="btn img-ins-pick">→...</button>
        <button class="btn img-replace">替换</button>
        <button class="btn btn-danger img-del">删</button>
      </div>
      <input type="file" class="img-replace-file" accept="image/*" hidden />`;
    const imgEl = div.querySelector("img");
    window.BPPX.images
      .fetchImageBlobUrl(projectId, meta.id)
      .then((u) => {
        if (u) imgEl.src = u;
      });
    div.querySelector(".img-cap").addEventListener("change", (e) => {
      meta.caption = e.target.value;
    });
    div.querySelector(".img-ins-know").addEventListener("click", () =>
      insertFigureInto(section, "knowledge", null, meta)
    );
    div.querySelector(".img-ins-pick").addEventListener("click", () => {
      const t = pickInsertTarget(section);
      if (!t) return;
      insertFigureInto(section, t.kind, t.idx, meta);
    });
    const repFile = div.querySelector(".img-replace-file");
    div.querySelector(".img-replace").addEventListener("click", () =>
      repFile.click()
    );
    repFile.addEventListener("change", async () => {
      const f = repFile.files[0];
      if (!f) return;
      try {
        await uploadAndRegister(section, f, {
          id: meta.id,
          caption: meta.caption,
          name: meta.name,
        });
        renderSections();
        toast("已替换", "ok");
      } catch (e) {
        toast("替换失败：" + e.message, "err");
      }
    });
    div.querySelector(".img-del").addEventListener("click", async () => {
      if (!confirm("删除该插图（同时清理服务端文件）？")) return;
      try {
        await window.BPPX.images.deleteImage(projectId, meta.id);
      } catch {}
      section.images.splice(mi, 1);
      renderSections();
    });
    return div;
  }

  function pickInsertTarget(section) {
    const opts = ["knowledge"];
    (section.examples || []).forEach((_, i) => opts.push("example:" + i));
    (section.exercises || []).forEach((_, i) => opts.push("exercise:" + i));
    const labels = opts.map((o) => {
      if (o === "knowledge") return "知识讲解";
      const [k, i] = o.split(":");
      return (k === "example" ? "例题 " : "习题 ") + (Number(i) + 1);
    });
    const choice = prompt(
      "选择插入位置（输入序号）：\n" +
        labels.map((l, i) => i + 1 + ". " + l).join("\n")
    );
    const n = Number(choice);
    if (!n || n < 1 || n > opts.length) return null;
    const v = opts[n - 1];
    if (v === "knowledge") return { kind: "knowledge" };
    const [k, i] = v.split(":");
    return { kind: k, idx: Number(i) };
  }

  function insertFigureInto(section, kind, idx, meta) {
    const snippet = window.BPPX.images.figureSnippet(meta.id, meta.caption);
    if (kind === "knowledge") {
      section.knowledge = (section.knowledge || "").trimEnd() + "\n\n" + snippet;
    } else if (kind === "example") {
      const ex = (section.examples = section.examples || [])[idx];
      if (!ex) return toast("例题不存在", "err");
      ex.q = (ex.q || "").trimEnd() + "\n\n" + snippet;
    } else if (kind === "exercise") {
      const ex = (section.exercises = section.exercises || [])[idx];
      if (!ex) return toast("习题不存在", "err");
      ex.q = (ex.q || "").trimEnd() + "\n\n" + snippet;
    }
    renderSections();
    toast("已插入", "ok");
  }
  function serializeQA(arr, ansKey) {
    if (!arr || !arr.length) return "";
    return arr
      .map(
        (x) =>
          (x.q || "").trim() +
          "\n%%ANS%%\n" +
          ((x[ansKey] || "").trim())
      )
      .join("\n%%EX%%\n");
  }
  function deserializeQA(text, ansKey) {
    if (!text || !text.trim()) return [];
    return text.split(/%%EX%%/).map((chunk) => {
      const parts = chunk.split(/%%ANS%%/);
      const obj = { q: (parts[0] || "").trim() };
      obj[ansKey] = (parts[1] || "").trim();
      return obj;
    });
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  $("#addSection").addEventListener("click", () => {
    project.sections.push({
      title: "",
      knowledge: "",
      examples: [],
      exercises: [],
    });
    renderSections();
  });
  $("#clearSections").addEventListener("click", () => {
    if (!confirm("清空所有章节？")) return;
    project.sections = [];
    renderSections();
  });

  // ----- generation -----
  $("#genAll").addEventListener("click", async () => {
    pullFromUI();
    const settings = store.loadSettings();
    const provider = resolveProvider("write");
    if (!provider)
      return toast("还没有配置任何 AI 提供商，请点右上角 ⚙ 添加", "err");

    const lines = $("#bookOutline")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return toast("请填写章节大纲", "err");

    // Ensure section entries exist for each outline line.
    project.sections = lines.map((l) => {
      const existing = (project.sections || []).find((s) => s.title === l);
      return (
        existing || {
          title: l,
          knowledge: "",
          examples: [],
          exercises: [],
        }
      );
    });
    renderSections();

    const total = project.sections.length;
    const prog = $("#genProg");
    prog.max = total;
    prog.value = 0;
    $("#genStop").disabled = false;
    $("#genAll").disabled = true;
    genAbort = false;

    const concurrency = Math.max(1, Number(settings.concurrency || 2));
    let cursor = 0;
    async function worker() {
      while (!genAbort && cursor < total) {
        const i = cursor++;
        $("#genStatus").textContent =
          "生成第 " + (i + 1) + "/" + total + " 节：" + project.sections[i].title;
        try {
          await generateSection(i);
        } catch (e) {
          toast("第 " + (i + 1) + " 节失败：" + e.message, "err");
        }
        prog.value = Math.max(prog.value, i + 1);
      }
    }
    const workers = Array.from({ length: concurrency }, worker);
    await Promise.all(workers);
    $("#genStop").disabled = true;
    $("#genAll").disabled = false;
    $("#genStatus").textContent = genAbort ? "已停止。" : "✓ 全部生成完成。";
    renderSections();
  });

  $("#genStop").addEventListener("click", () => {
    genAbort = true;
  });

  async function generateSection(idx) {
    pullFromUI();
    const settings = store.loadSettings();
    const provider = resolveProvider("write");
    if (!provider) throw new Error("还没有配置任何 AI 提供商");
    const s = project.sections[idx];
    const unit = $("#genUnit").value;
    const words = $("#genWords").value;
    const sys = settings.sysWrite || "";
    const user = buildGenPrompt(s, unit, words);
    const r = await ai.generate({
      provider,
      system: sys,
      user,
      max_tokens: 0,
      temperature: 0,
    });
    const content = (r && r.content) || "";
    applyGenResult(s, content, unit);
    renderSections();
  }

  function buildGenPrompt(section, unit, words) {
    const parts = [];
    parts.push("书名：" + (project.title || "未命名"));
    parts.push("读者层次：" + (project.level || ""));
    parts.push("本节标题：" + (section.title || ""));
    if (project.refSummary)
      parts.push(
        "\n参考资料摘要（请在此基础上写作，但不要直接抄袭）：\n" +
          project.refSummary.slice(0, 6000)
      );
    parts.push(
      "\n请输出 LaTeX 代码片段（不要 \\documentclass，不要 \\begin{document}）。"
    );
    parts.push("约 " + words + " 字。");
    parts.push(
      "请使用以下机器可读分节标记：\n" +
        "[[KNOWLEDGE]]\n知识讲解 LaTeX...\n" +
        "[[EXAMPLES]]\n例题 1：\\begin{example}...\\end{example}\\begin{solution}...\\end{solution}\n%%EX%%\n例题 2：...\n" +
        "[[EXERCISES]]\n习题 1：\\begin{exercise}...\\end{exercise}\\begin{solution}...\\end{solution}\n%%EX%%\n..."
    );
    if (unit === "knowledge")
      parts.push("仅输出 [[KNOWLEDGE]] 段，其它段保留空。");
    else if (unit === "example")
      parts.push("仅输出 [[EXAMPLES]]，3-5 题，每题含详细解析。");
    else if (unit === "exercise")
      parts.push("仅输出 [[EXERCISES]]，4-6 题，含完整答案。");
    else
      parts.push(
        "三段都要：知识讲解、2-4 道例题（含解析）、3-5 道习题（含答案）。"
      );
    return parts.join("\n");
  }

  function applyGenResult(section, content, unit) {
    const know = pickBlock(content, "KNOWLEDGE");
    const exs = pickBlock(content, "EXAMPLES");
    const xrs = pickBlock(content, "EXERCISES");
    if (unit === "knowledge" || unit === "all")
      if (know) section.knowledge = know;
    if (unit === "example" || unit === "all")
      if (exs) section.examples = parseGenBlocks(exs, "example", "sol");
    if (unit === "exercise" || unit === "all")
      if (xrs) section.exercises = parseGenBlocks(xrs, "exercise", "a");
    // Fallback: nothing matched — dump as knowledge.
    if (!know && !exs && !xrs && content.trim()) {
      section.knowledge = content.trim();
    }
  }

  function pickBlock(text, tag) {
    const re = new RegExp(
      "\\[\\[" + tag + "\\]\\]([\\s\\S]*?)(?=\\[\\[[A-Z]+\\]\\]|$)"
    );
    const m = text.match(re);
    return m ? m[1].trim() : "";
  }
  function parseGenBlocks(blob, envName, ansKey) {
    const chunks = blob.split(/%%EX%%/);
    return chunks
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
  }

  // ----- template tab -----
  function renderTemplate() {
    const t = project.template;
    const pre = tex.buildPreamble({
      docClass: $("#tplDocClass").value,
      opts: $("#tplOpts").value,
      font: $("#tplFont").value,
      pkgs: $("#tplPkgs").value,
      theorems: $("#tplTheorems").value,
      extra: $("#tplExtra").value,
    });
    $("#tplPreview").textContent = pre;
  }
  ["tplDocClass", "tplOpts", "tplFont", "tplPkgs", "tplTheorems", "tplExtra"].forEach(
    (id) => $("#" + id).addEventListener("input", renderTemplate)
  );
  $("#tplSave").addEventListener("click", () => {
    pullFromUI();
    toast("已保存（点击右上『保存』以持久化）", "ok");
  });
  $("#tplReset").addEventListener("click", () => {
    if (!confirm("重置为默认模板？")) return;
    project.template = store.emptyProject().template;
    bindToUI();
  });

  // ----- merge tab -----
  let mergedTex = "";
  $("#mergeFiles").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const list = $("#mergeList");
    list.innerHTML = "";
    const items = [];
    for (const f of files) {
      const text = await f.text();
      items.push({ name: f.name, content: text });
      const row = document.createElement("div");
      row.className = "merge-item";
      row.innerHTML = `<span class="fname">${escapeHtml(f.name)}</span><span class="muted">${text.length} chars</span>`;
      list.appendChild(row);
    }
    list.dataset.files = JSON.stringify(items);
  });
  $("#mergeRun").addEventListener("click", () => {
    pullFromUI();
    const items = JSON.parse($("#mergeList").dataset.files || "[]");
    if (!items.length) return toast("请先选择 .tex 文件", "err");
    mergedTex = tex.mergeFiles(items, project.template, {
      title: project.title,
      author: project.author,
      headingLevel: "chapter",
    });
    $("#mergeResult").value = mergedTex;
    $("#mergeDownload").disabled = false;
    toast("合并完成", "ok");
  });
  $("#mergeDownload").addEventListener("click", () =>
    download((project.title || "book") + "_merged.tex", mergedTex)
  );

  // ----- proofread -----
  function refreshProofSection() {
    const sel = $("#proofSection");
    sel.innerHTML = "";
    sel.appendChild(new Option("— 全书 —", "*"));
    project.sections.forEach((s, i) =>
      sel.appendChild(new Option(`${i + 1}. ${s.title || "(未命名)"}`, String(i)))
    );
  }
  $("#proofRun").addEventListener("click", async () => {
    pullFromUI();
    const settings = store.loadSettings();
    const providers = resolveProofProviders();
    if (!providers.length)
      return toast("还没有配置任何 AI 提供商，请点右上角 ⚙ 添加", "err");
    const targets = $$(".proof-target:checked").map((c) => c.value);
    if (!targets.length) return toast("至少选一项校对目标", "err");
    const which = $("#proofSection").value;
    const sections =
      which === "*" ? project.sections : [project.sections[Number(which)]];
    const container = $("#proofResults");
    container.innerHTML = "";

    for (const [si, s] of sections.entries()) {
      if (!s) continue;
      const block = document.createElement("div");
      block.className = "proof-block";
      block.innerHTML = `<h4>第 ${(which === "*" ? si : Number(which)) + 1} 节：${escapeHtml(s.title || "")}</h4>`;
      container.appendChild(block);
      const latexBits = [];
      if (targets.includes("knowledge") && s.knowledge)
        latexBits.push("% 知识讲解\n" + s.knowledge);
      if (targets.includes("example"))
        for (const ex of s.examples || [])
          latexBits.push(
            "\\begin{example}\n" +
              ex.q +
              "\n\\end{example}\n\\begin{solution}\n" +
              (ex.sol || "") +
              "\n\\end{solution}"
          );
      if (targets.includes("exercise"))
        for (const ex of s.exercises || [])
          latexBits.push(
            "\\begin{exercise}\n" +
              ex.q +
              "\n\\end{exercise}\n\\begin{solution}\n" +
              (ex.a || "") +
              "\n\\end{solution}"
          );
      const latex = latexBits.join("\n\n");
      for (const pname of providers) {
        const pblock = document.createElement("div");
        pblock.innerHTML = `<strong>${escapeHtml(pname)}</strong> <span class="muted small">校对中...</span>`;
        block.appendChild(pblock);
        try {
          const res = await ai.proofread({
            provider: pname,
            system: settings.sysProof || "",
            latex,
            targets,
          });
          const suggestions = parseProofResponse(res.content || "");
          pblock.innerHTML = `<strong>${escapeHtml(pname)}</strong> <span class="muted small">${suggestions.length} 条建议</span>`;
          suggestions.forEach((sug) =>
            pblock.appendChild(renderSuggestion(sug, s))
          );
        } catch (e) {
          pblock.innerHTML = `<strong>${escapeHtml(pname)}</strong> <span class="muted small">✗ ${escapeHtml(e.message)}</span>`;
        }
      }
    }
  });

  function parseProofResponse(content) {
    // Try to extract JSON array even if wrapped in ```json ... ```.
    let s = content.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr : [];
    } catch {
      // Fallback: split lines into pseudo-suggestions
      return s
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((t) => ({ issue: t, suggestion: "", patch: "" }));
    }
  }

  function renderSuggestion(sug, section) {
    const div = document.createElement("div");
    div.className = "proof-suggestion";
    div.innerHTML = `
      <div class="loc">${escapeHtml(sug.location || "")}</div>
      <div class="issue">⚠ ${escapeHtml(sug.issue || "")}</div>
      <div class="sugg">💡 ${escapeHtml(sug.suggestion || "")}</div>
      ${
        sug.patch
          ? `<pre>${escapeHtml(sug.patch)}</pre>`
          : ""
      }
      <div class="actions">
        ${
          sug.patch
            ? `<button class="btn btn-primary s-accept">接受建议（追加到知识讲解末尾）</button>
               <button class="btn s-replace">替换知识讲解</button>`
            : ""
        }
        <button class="btn s-dismiss">忽略</button>
      </div>`;
    const accept = div.querySelector(".s-accept");
    if (accept)
      accept.addEventListener("click", () => {
        section.knowledge = (section.knowledge || "") + "\n\n% [AI 建议]\n" + sug.patch;
        renderSections();
        toast("已追加建议", "ok");
      });
    const rep = div.querySelector(".s-replace");
    if (rep)
      rep.addEventListener("click", () => {
        if (!confirm("用建议替换整段知识讲解？")) return;
        section.knowledge = sug.patch;
        renderSections();
        toast("已替换", "ok");
      });
    div.querySelector(".s-dismiss").addEventListener("click", () => div.remove());
    return div;
  }

  // ----- export -----
  function refreshExportPickers() {
    const sec = $("#singleSection");
    sec.innerHTML = "";
    project.sections.forEach((s, i) =>
      sec.appendChild(new Option(`${i + 1}. ${s.title || ""}`, String(i)))
    );
    refreshSingleItems();
  }
  function refreshSingleItems() {
    const idx = Number($("#singleSection").value || 0);
    const s = project.sections[idx];
    const item = $("#singleItem");
    item.innerHTML = "";
    if (!s) return;
    (s.examples || []).forEach((ex, i) =>
      item.appendChild(
        new Option(
          "例题 " + (i + 1) + ": " + (ex.q || "").slice(0, 30),
          "example:" + i
        )
      )
    );
    (s.exercises || []).forEach((ex, i) =>
      item.appendChild(
        new Option(
          "习题 " + (i + 1) + ": " + (ex.q || "").slice(0, 30),
          "exercise:" + i
        )
      )
    );
  }
  $("#singleSection").addEventListener("change", refreshSingleItems);
  $$('input[name="exMode"]').forEach((r) =>
    r.addEventListener("change", () => {
      $("#singlePicker").style.display = $(
        'input[name="exMode"]:checked'
      ).value === "single"
        ? ""
        : "none";
    })
  );
  $("#exBuild").addEventListener("click", () => {
    pullFromUI();
    const mode = $('input[name="exMode"]:checked').value;
    let out = "";
    if (mode === "full") out = tex.buildFull(project);
    else if (mode === "body") out = tex.buildBodyOnly(project);
    else if (mode === "preamble") out = tex.buildPreamble(project.template);
    else if (mode === "single") {
      const sIdx = Number($("#singleSection").value || 0);
      const key = $("#singleItem").value;
      out = tex.buildSingle(project, sIdx, key);
    }
    $("#exOut").value = out;
  });
  $("#exDownload").addEventListener("click", () => {
    const out = $("#exOut").value;
    if (!out) return toast("请先生成", "err");
    const mode = $('input[name="exMode"]:checked').value;
    const name = (project.title || "book") + "_" + mode + ".tex";
    download(name, out);
  });
  $("#exCopy").addEventListener("click", async () => {
    const out = $("#exOut").value;
    if (!out) return;
    try {
      await navigator.clipboard.writeText(out);
      toast("已复制到剪贴板", "ok");
    } catch {
      $("#exOut").select();
      document.execCommand("copy");
      toast("已复制", "ok");
    }
  });
  $("#exDownloadZip").addEventListener("click", async () => {
    const out = $("#exOut").value;
    if (!out) return toast("请先生成", "err");
    if (typeof JSZip === "undefined")
      return toast("JSZip 未加载（检查网络/CDN）", "err");
    if (!projectId) return toast("先输入项目 ID 才能打包图片", "err");
    const refs = window.BPPX.images.extractRefs(out);
    const zip = new JSZip();
    const base = (project.title || "book").replace(/\s+/g, "_");
    zip.file(base + ".tex", out);
    const imgs = zip.folder("images");
    let ok = 0,
      miss = 0;
    for (const id of refs) {
      try {
        const r = await fetch(window.BPPX.images.imageUrl(projectId, id), {
          headers: store.loadSettings().shareToken
            ? { "x-share-token": store.loadSettings().shareToken }
            : {},
        });
        if (!r.ok) {
          miss++;
          continue;
        }
        const ab = await r.arrayBuffer();
        imgs.file(id + ".png", ab);
        ok++;
      } catch {
        miss++;
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = base + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`已打包：${ok} 张图${miss ? "（缺失 " + miss + "）" : ""}`, "ok");
  });

  function download(name, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ----- AI image modal -----
  function openImgModal(sectionIdx) {
    imgModalCtx = { sectionIdx, blob: null };
    $("#imgPrompt").value = "";
    $("#imgCaption").value = "";
    $("#imgPreview").innerHTML = "";
    $("#imgStatus").textContent = "";
    $("#imgInsert").disabled = true;
    rebuildImgInsertTargets(project.sections[sectionIdx]);
    $("#imgModal").hidden = false;
  }
  function closeImgModal() {
    imgModalCtx = null;
    $("#imgModal").hidden = true;
  }
  function rebuildImgInsertTargets(section) {
    const sel = $("#imgInsertTarget");
    sel.innerHTML = "";
    sel.appendChild(new Option("→ 知识讲解末尾", "knowledge"));
    (section.examples || []).forEach((_, i) =>
      sel.appendChild(new Option("→ 例题 " + (i + 1), "example:" + i))
    );
    (section.exercises || []).forEach((_, i) =>
      sel.appendChild(new Option("→ 习题 " + (i + 1), "exercise:" + i))
    );
  }
  $("#imgCancel").addEventListener("click", closeImgModal);
  $("#imgGen").addEventListener("click", async () => {
    const prompt = $("#imgPrompt").value.trim();
    if (!prompt) return toast("提示词为空", "err");
    const provider = resolveProvider("image");
    if (!provider)
      return toast("还没有配置任何 AI 提供商，请点右上角 ⚙ 添加", "err");
    const status = $("#imgStatus");
    status.textContent = "AI 生成中...";
    $("#imgInsert").disabled = true;
    try {
      const png = await window.BPPX.images.generate(prompt, {
        provider,
        size: $("#imgSize").value,
      });
      imgModalCtx.blob = png.blob;
      imgModalCtx.width = png.width;
      imgModalCtx.height = png.height;
      const url = URL.createObjectURL(png.blob);
      $("#imgPreview").innerHTML =
        '<img src="' + url + '" alt="预览" />';
      $("#imgInsert").disabled = false;
      status.textContent = "✓ 生成完成（点击下方保存并插入）";
    } catch (e) {
      status.textContent = "✗ " + e.message;
    }
  });
  $("#imgInsert").addEventListener("click", async () => {
    if (!imgModalCtx || !imgModalCtx.blob) return;
    if (!projectId)
      return toast("先在右上输入项目 ID 并保存一次再生成图", "err");
    const section = project.sections[imgModalCtx.sectionIdx];
    if (!section) return toast("章节丢失", "err");
    try {
      const meta = await uploadAndRegister(
        section,
        new File([imgModalCtx.blob], "ai.png", { type: "image/png" }),
        { caption: $("#imgCaption").value }
      );
      const target = $("#imgInsertTarget").value;
      if (target === "knowledge") insertFigureInto(section, "knowledge", null, meta);
      else {
        const [k, i] = target.split(":");
        insertFigureInto(section, k, Number(i), meta);
      }
      closeImgModal();
    } catch (e) {
      toast("保存失败：" + e.message, "err");
    }
  });

  // ----- PDF translate pipeline -----
  let pdfJob = null;

  function pdfRender() {
    const list = $("#pdfChunkList");
    list.innerHTML = "";
    if (!pdfJob || !pdfJob.chunks.length) {
      $("#pdfProg").value = 0;
      $("#pdfRunStatus").textContent = "";
      return;
    }
    const done = pdfJob.chunks.filter((c) => c.status === "done").length;
    $("#pdfProg").max = pdfJob.chunks.length;
    $("#pdfProg").value = done;
    $("#pdfRunStatus").textContent =
      `${done}/${pdfJob.chunks.length} 已完成` +
      (pdfJob.running ? "（运行中）" : pdfJob.autoMode ? "（自动模式）" : "（暂停中）");
    pdfJob.chunks.forEach((c, i) => list.appendChild(chunkRow(c, i)));
  }

  function chunkRow(c, i) {
    const row = document.createElement("div");
    row.className = "chunk-row chunk-" + c.status;
    const head = document.createElement("div");
    head.className = "chunk-head";
    head.innerHTML = `
      <span class="badge ${c.status}">${labelStatus(c.status)}</span>
      <input class="ch-title" value="${escapeHtml(c.title || "")}" />
      <span class="muted small">${c.text.length} 字</span>
      <button class="btn ch-toggle">预览原文</button>
      <button class="btn ch-skip">跳过</button>
      <button class="btn ch-retry">重试</button>
      <button class="btn ch-jump" ${c.status === "done" ? "" : "disabled"}>跳到写作</button>`;
    row.appendChild(head);
    const body = document.createElement("div");
    body.className = "chunk-body";
    body.style.display = "none";
    body.innerHTML = `
      <details><summary>原文</summary><pre class="code">${escapeHtml(c.text.slice(0, 4000))}${c.text.length > 4000 ? "\n... [截断显示前 4000 字]" : ""}</pre></details>
      ${c.output ? `<details open><summary>AI 输出</summary><pre class="code">${escapeHtml(c.output.slice(0, 4000))}${c.output.length > 4000 ? "\n... [截断]" : ""}</pre></details>` : ""}
      ${c.error ? `<div class="muted small" style="color:var(--danger)">${escapeHtml(c.error)}</div>` : ""}`;
    row.appendChild(body);
    head.querySelector(".ch-toggle").addEventListener("click", () => {
      body.style.display = body.style.display === "none" ? "" : "none";
    });
    head.querySelector(".ch-title").addEventListener("input", (e) => {
      c.title = e.target.value;
    });
    head.querySelector(".ch-skip").addEventListener("click", () => {
      c.status = "skipped";
      if (pdfJob.cursor === i) pdfJob.cursor++;
      pdfRender();
    });
    head.querySelector(".ch-retry").addEventListener("click", () => {
      c.status = "pending";
      c.error = "";
      c.output = "";
      if (pdfJob.cursor > i) pdfJob.cursor = i;
      pdfRender();
    });
    head.querySelector(".ch-jump").addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".panel").forEach((x) => x.classList.remove("active"));
      document.querySelector('.tab[data-tab="write"]').classList.add("active");
      $('.panel[data-panel="write"]').classList.add("active");
      const target = document.querySelectorAll(".section-item")[c.sectionIdx];
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return row;
  }
  function labelStatus(s) {
    return (
      { pending: "等待", running: "运行中", done: "✓", error: "✗", skipped: "—" }[s] ||
      s
    );
  }

  $("#pdfParse").addEventListener("click", async () => {
    const f = $("#pdfFile").files[0];
    if (!f) return toast("请选择 PDF", "err");
    const status = $("#pdfParseStatus");
    status.textContent = "加载 pdf.js...";
    try {
      const out = await window.BPPX.pdfTranslate.extractPdfText(f, (i, n) => {
        status.textContent = `解析中 ${i}/${n} 页`;
      });
      const fullText = out.pages.join("\n\n");
      project.pdf = project.pdf || {};
      project.pdf.fileName = f.name;
      project.pdf.numPages = out.numPages;
      project.pdf.fullText = fullText;
      $("#pdfFullText").value = fullText.slice(0, 200000); // UI cap
      status.textContent = `✓ 完成：${out.numPages} 页，${fullText.length.toLocaleString()} 字`;
    } catch (e) {
      status.textContent = "✗ " + e.message;
      toast("解析失败：" + e.message, "err");
    }
  });

  $("#pdfChunk").addEventListener("click", () => {
    const text = $("#pdfFullText").value || (project.pdf && project.pdf.fullText);
    if (!text) return toast("请先解析 PDF", "err");
    const strategy = $$('input[name="pdfStrategy"]:checked')[0].value;
    const size = Number($("#pdfChunkSize").value) || 8000;
    let chunks;
    if (strategy === "length") {
      chunks = window.BPPX.pdfTranslate.chunkByLength(text, size);
    } else if (strategy === "chapter") {
      chunks = window.BPPX.pdfTranslate.chunkByChapter(text);
      if (!chunks || chunks.length < 2) {
        return toast("未检测到章节标记。请改用『仅按长度』或『自动』。", "err");
      }
    } else {
      chunks = window.BPPX.pdfTranslate.chunkText(text, { target: size });
    }
    pdfJob = window.BPPX.pdfTranslate.makeJob(chunks, {
      batchSize: Number($("#pdfBatch").value) || 1,
      autoMode: $("#pdfAuto").checked,
      style: $("#pdfStyle").value,
      provider: resolveProvider("write"),
      onUpdate: pdfRender,
      onBatchPause: () => toast("本批完成，已暂停 — 点继续下一批", "ok"),
      onFinish: () =>
        toast(
          "✓ 全部完成 " +
            pdfJob.chunks.filter((c) => c.status === "done").length +
            "/" +
            pdfJob.chunks.length,
          "ok"
        ),
    });
    // Persist into project so coworkers see the same state on reload.
    project.pdf.chunks = pdfJob.chunks;
    project.pdf.cursor = 0;
    project.pdf.batchSize = pdfJob.batchSize;
    project.pdf.autoMode = pdfJob.autoMode;
    project.pdf.style = pdfJob.style;
    $("#pdfChunkStatus").textContent = "已切成 " + chunks.length + " 块";
    pdfRender();
  });

  $("#pdfRun").addEventListener("click", async () => {
    if (!pdfJob || !pdfJob.chunks.length) {
      // Try to resume from project state.
      if (project.pdf && project.pdf.chunks && project.pdf.chunks.length) {
        pdfJob = window.BPPX.pdfTranslate.makeJob(project.pdf.chunks, {
          batchSize: Number($("#pdfBatch").value) || project.pdf.batchSize || 1,
          autoMode: $("#pdfAuto").checked,
          style: $("#pdfStyle").value || project.pdf.style,
          provider: resolveProvider("write"),
          onUpdate: pdfRender,
          onBatchPause: () => toast("本批完成，已暂停 — 点继续下一批", "ok"),
          onFinish: () => toast("✓ 全部完成", "ok"),
        });
        // restore cursor + per-chunk state
        pdfJob.chunks.forEach((c, i) => {
          const old = project.pdf.chunks[i];
          if (old) Object.assign(c, old);
        });
        pdfJob.cursor = project.pdf.cursor || 0;
      } else {
        return toast("请先切块", "err");
      }
    }
    if (pdfJob.running) return;
    // Sync UI changes into job
    pdfJob.batchSize = Number($("#pdfBatch").value) || 1;
    pdfJob.autoMode = $("#pdfAuto").checked;
    pdfJob.style = $("#pdfStyle").value;
    pdfJob.provider = resolveProvider("write");
    if (!pdfJob.provider)
      return toast(
        "还没有配置任何 AI 提供商。点右上角 ⚙ 进入设置，添加并保存一个提供商。",
        "err"
      );

    $("#pdfPause").disabled = false;
    $("#pdfRun").disabled = true;
    try {
      await window.BPPX.pdfTranslate.run(pdfJob, (sec) => {
        project.sections.push(sec);
        // Tag the chunk with its section idx for the "跳到写作" jump button.
        const last = pdfJob.chunks[pdfJob.cursor];
        if (last) last.sectionIdx = project.sections.length - 1;
        // mirror to project.pdf
        project.pdf.chunks = pdfJob.chunks.map((x) => ({ ...x }));
        project.pdf.cursor = pdfJob.cursor;
        renderSections();
        refreshProofSection();
        refreshExportPickers();
      });
    } finally {
      $("#pdfPause").disabled = true;
      $("#pdfRun").disabled = false;
      project.pdf.chunks = pdfJob.chunks.map((x) => ({ ...x }));
      project.pdf.cursor = pdfJob.cursor;
      pdfRender();
    }
  });

  $("#pdfPause").addEventListener("click", () => {
    if (pdfJob) {
      window.BPPX.pdfTranslate.pause(pdfJob);
      toast("正在停止（等待当前章节结束）...", "");
    }
  });

  $("#pdfAuto").addEventListener("change", () => {
    if (pdfJob) window.BPPX.pdfTranslate.setAutoMode(pdfJob, $("#pdfAuto").checked);
  });

  $("#pdfReset").addEventListener("click", () => {
    if (!confirm("重置 PDF 翻译任务？已生成的章节会保留在『写作』中。")) return;
    pdfJob = null;
    project.pdf = store.emptyProject().pdf;
    $("#pdfFullText").value = "";
    $("#pdfChunkStatus").textContent = "";
    pdfRender();
  });

  function bindPdfFromProject() {
    if (!project.pdf) return;
    $("#pdfFullText").value = project.pdf.fullText || "";
    if (project.pdf.chunks && project.pdf.chunks.length) {
      pdfJob = window.BPPX.pdfTranslate.makeJob(project.pdf.chunks, {
        batchSize: project.pdf.batchSize || 1,
        autoMode: project.pdf.autoMode,
        style: project.pdf.style || "rewrite",
        provider: resolveProvider("write"),
        onUpdate: pdfRender,
        onBatchPause: () => toast("本批完成", "ok"),
        onFinish: () => toast("✓ 全部完成", "ok"),
      });
      pdfJob.chunks.forEach((c, i) =>
        Object.assign(c, project.pdf.chunks[i])
      );
      pdfJob.cursor = project.pdf.cursor || 0;
    }
    pdfRender();
  }

  // ----- init -----
  if (projectId) {
    const local = store.loadLocalProject(projectId);
    if (local) project = { ...store.emptyProject(), ...local };
  }
  bindToUI();
  // Pull provider config from the server (best-effort) so a fresh browser,
  // or one where config was only entered on the settings page, still works.
  bootstrapSettingsFromRemote();
})();
