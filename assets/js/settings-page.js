// Settings page (gear) logic.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = window.BPPX.storage;

  function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show " + kind;
    setTimeout(() => (t.className = "toast"), 2400);
  }

  // Default API base URL per provider type.
  const DEFAULT_BASE = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };

  let settings = store.loadSettings();

  // JSON snapshot of each provider as last persisted to the server.
  // Used to mark the card "未保存" when the form fields drift.
  let lastSavedSnap = new Map(); // name -> JSON

  function newProvider(p = {}) {
    return {
      name: p.name || "",
      type: p.type || "openai",
      base: p.base || "",
      model: p.model || "",
      imageModel: p.imageModel || "",
      key: p.key || "",
      temp: p.temp ?? 0.5,
      max: p.max ?? 4096,
      // tested: { ok, msg, at }   ← filled after each test
    };
  }

  // For dirty-tracking we ignore the "tested" status field (it's just metadata).
  function snapshot(p) {
    if (!p) return "";
    const { tested, ...rest } = p;
    return JSON.stringify(rest);
  }
  function isDirty(p) {
    return snapshot(p) !== (lastSavedSnap.get(p.name) || "");
  }
  function markAllSaved() {
    lastSavedSnap = new Map();
    (settings.providers || []).forEach((p) =>
      lastSavedSnap.set(p.name, snapshot(p))
    );
  }

  function render() {
    const list = $("#providerList");
    list.innerHTML = "";
    settings.providers = settings.providers || [];
    settings.providers.forEach((p, i) => list.appendChild(buildCard(p, i)));
    renderSummary();
    refreshDropdowns();
    $("#defTimeout").value = settings.timeout || 120;
    $("#defConcurrency").value = settings.concurrency || 2;
    $("#defSysWrite").value =
      settings.sysWrite ||
      $("#defSysWrite").defaultValue ||
      $("#defSysWrite").value;
    $("#defSysProof").value =
      settings.sysProof ||
      $("#defSysProof").defaultValue ||
      $("#defSysProof").value;
    $("#shareToken").value = settings.shareToken || "";
  }

  function renderSummary() {
    const wrap = $("#providerSummary");
    if (!wrap) return;
    const list = settings.providers || [];
    if (!list.length) {
      wrap.innerHTML =
        '<div class="muted small">暂无已配置的提供商。点击下方「添加提供商」开始。</div>';
      return;
    }
    const items = list.map((p) => {
      const dirty = isDirty(p);
      let icon = '<span class="badge">未保存</span>';
      if (!dirty) {
        if (p.tested && p.tested.ok)
          icon = '<span class="badge done">✓ 已测试通过</span>';
        else if (p.tested && p.tested.ok === false)
          icon = '<span class="badge error">✗ 测试失败</span>';
        else icon = '<span class="badge done">已保存（未测试）</span>';
      }
      const name = p.name || "(未命名)";
      const meta = (p.type || "?") + " · " + (p.model || "未设模型");
      return `<div class="prov-row"><strong>${escapeHtml(name)}</strong> <span class="muted small">${escapeHtml(meta)}</span> ${icon}</div>`;
    });
    wrap.innerHTML =
      '<div class="prov-summary-title">已配置的提供商</div>' + items.join("");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildCard(p, idx) {
    const tpl = $("#providerTpl").content.cloneNode(true);
    const root = tpl.querySelector(".provider");
    const fields = {
      name: tpl.querySelector(".p-name"),
      type: tpl.querySelector(".p-type"),
      base: tpl.querySelector(".p-base"),
      model: tpl.querySelector(".p-model"),
      imageModel: tpl.querySelector(".p-imodel"),
      key: tpl.querySelector(".p-key"),
      temp: tpl.querySelector(".p-temp"),
      max: tpl.querySelector(".p-max"),
    };
    Object.entries(fields).forEach(([k, el]) => (el.value = p[k] || ""));
    // When the provider type changes, fill the matching default Base URL.
    // We overwrite the field if it's empty OR still holds another type's
    // default (i.e. the user hasn't customised it); a hand-typed base is
    // left untouched.
    const knownDefaults = Object.values(DEFAULT_BASE);
    const applyDefaultBase = () => {
      const cur = fields.base.value.trim();
      if (!cur || knownDefaults.includes(cur)) {
        fields.base.value = DEFAULT_BASE[fields.type.value] || "";
      }
    };
    fields.type.addEventListener("change", applyDefaultBase);
    if (!p.base) applyDefaultBase();
    const savedBadge = root.querySelector(".p-saved-badge");
    const testedBadge = root.querySelector(".p-tested-badge");
    const updateBadges = () => {
      const cur = settings.providers[idx];
      if (!cur) return;
      const dirty = isDirty(cur);
      savedBadge.className = "p-saved-badge badge " + (dirty ? "" : "done");
      savedBadge.textContent = dirty ? "未保存" : "已保存";
      if (cur.tested && cur.tested.ok) {
        testedBadge.className = "p-tested-badge badge done";
        testedBadge.title = cur.tested.msg || "";
        testedBadge.textContent = "✓ 测试通过";
      } else if (cur.tested && cur.tested.ok === false) {
        testedBadge.className = "p-tested-badge badge error";
        testedBadge.title = cur.tested.msg || "";
        testedBadge.textContent = "✗ 测试失败";
      } else {
        testedBadge.className = "p-tested-badge";
        testedBadge.textContent = "";
      }
    };
    const sync = () => {
      settings.providers[idx] = {
        ...settings.providers[idx], // preserve `tested` and other metadata
        name: fields.name.value.trim(),
        type: fields.type.value,
        base: fields.base.value.trim(),
        model: fields.model.value.trim(),
        imageModel: fields.imageModel.value.trim(),
        key: fields.key.value,
        temp: Number(fields.temp.value),
        max: Number(fields.max.value),
      };
      refreshDropdowns();
      updateBadges();
      renderSummary();
    };
    root.addEventListener("input", sync);
    root.addEventListener("change", sync);

    tpl.querySelector(".p-del").addEventListener("click", async () => {
      if (!confirm("删除此提供商？")) return;
      settings.providers.splice(idx, 1);
      await persist();
      render();
    });

    tpl.querySelector(".p-save").addEventListener("click", async () => {
      const status = root.querySelector(".p-status");
      status.textContent = "保存中...";
      status.style.color = "";
      try {
        await persist();
        status.textContent = "✓ 已保存";
        status.style.color = "var(--ok)";
        toast("已保存", "ok");
        updateBadges();
        renderSummary();
      } catch (e) {
        status.textContent = "✗ " + e.message;
        status.style.color = "var(--danger)";
      }
    });

    tpl.querySelector(".p-test").addEventListener("click", async () => {
      const status = root.querySelector(".p-status");
      status.textContent = "保存并测试中...";
      status.style.color = "";
      try {
        await persist();
        const res = await fetch("/api/ai/test", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(settings.shareToken
              ? { "x-share-token": settings.shareToken }
              : {}),
          },
          body: JSON.stringify({ provider: fields.name.value.trim() }),
        }).then((r) => r.json());
        const cur = settings.providers[idx];
        if (cur) {
          cur.tested = {
            ok: !!(res && res.ok),
            msg: (res && (res.sample || res.error)) || "",
            at: Date.now(),
          };
        }
        if (res && res.ok) {
          status.textContent = "✓ 连通：" + (res.sample || "OK");
          status.style.color = "var(--ok)";
        } else {
          status.textContent = "✗ " + (res && res.error ? res.error : "失败");
          status.style.color = "var(--danger)";
        }
        // Persist tested status to server too.
        await persist();
        updateBadges();
        renderSummary();
      } catch (e) {
        status.textContent = "✗ " + e.message;
        status.style.color = "var(--danger)";
      }
    });

    updateBadges();
    return root;
  }

  function refreshDropdowns() {
    const names = (settings.providers || [])
      .map((p) => p.name)
      .filter(Boolean);
    function fill(sel, multi) {
      const cur = multi
        ? Array.from(sel.selectedOptions).map((o) => o.value)
        : sel.value;
      sel.innerHTML = "";
      if (!multi) sel.appendChild(new Option("（未选择）", ""));
      names.forEach((n) => sel.appendChild(new Option(n, n)));
      if (multi) {
        const want = settings.proof || [];
        Array.from(sel.options).forEach(
          (o) => (o.selected = want.includes(o.value))
        );
      } else {
        sel.value = cur || settings[sel.id.replace("def", "").toLowerCase()] || "";
      }
    }
    fill($("#defWrite"));
    fill($("#defParse"));
    fill($("#defImage"));
    fill($("#defProof"), true);
    $("#defWrite").value = settings.write || $("#defWrite").value;
    $("#defParse").value = settings.parse || $("#defParse").value;
    $("#defImage").value = settings.image || $("#defImage").value;
  }

  async function persist() {
    settings.timeout = Number($("#defTimeout").value) || 120;
    settings.concurrency = Number($("#defConcurrency").value) || 2;
    settings.write = $("#defWrite").value;
    settings.parse = $("#defParse").value;
    settings.image = $("#defImage").value;
    settings.proof = Array.from($("#defProof").selectedOptions).map(
      (o) => o.value
    );
    settings.sysWrite = $("#defSysWrite").value;
    settings.sysProof = $("#defSysProof").value;
    settings.shareToken = $("#shareToken").value.trim();
    store.saveSettings(settings);
    // Always push to server so /api/ai/test etc. can find providers by name.
    // Bootstrap PUT is accepted when the server has no shareToken yet.
    const headers = { "content-type": "application/json" };
    if (settings.shareToken) headers["x-share-token"] = settings.shareToken;
    try {
      const r = await fetch("/api/store/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify(settings),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.warn("settings push failed:", r.status, t);
        toast(
          "保存到云端失败（" + r.status + "）。本地已保存。",
          "err"
        );
        renderSummary();
        return false;
      }
      markAllSaved();
      renderSummary();
      return true;
    } catch (e) {
      console.warn("settings push error:", e);
      toast("保存到云端失败：" + e.message + "。本地已保存。", "err");
      renderSummary();
      return false;
    }
  }

  $("#addProvider").addEventListener("click", async () => {
    settings.providers = settings.providers || [];
    settings.providers.push(newProvider());
    await persist();
    render();
  });
  $("#testAll").addEventListener("click", async () => {
    await persist();
    for (const p of settings.providers || []) {
      try {
        const r = await fetch("/api/ai/test", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(settings.shareToken
              ? { "x-share-token": settings.shareToken }
              : {}),
          },
          body: JSON.stringify({ provider: p.name }),
        }).then((r) => r.json());
        toast(
          (r && r.ok ? "✓ " : "✗ ") +
            p.name +
            (r && r.error ? ": " + r.error : ""),
          r && r.ok ? "ok" : "err"
        );
      } catch (e) {
        toast("✗ " + p.name + ": " + e.message, "err");
      }
    }
  });
  $("#saveDefaults").addEventListener("click", async () => {
    await persist();
    toast("已保存默认配置", "ok");
  });
  $("#saveShare").addEventListener("click", async () => {
    await persist();
    toast("已保存共享 Token", "ok");
  });

  // On first load, try to pull existing remote settings (without keys) so a
  // coworker on a new machine sees the team's provider list. We don't
  // overwrite local API keys when merging.
  async function bootstrapFromRemote() {
    try {
      const headers = settings.shareToken
        ? { "x-share-token": settings.shareToken }
        : {};
      const r = await fetch("/api/store/settings", { headers });
      if (!r.ok) return;
      const remote = await r.json();
      if (!remote || !remote.providers) return;
      // Preserve local-only API keys for matching provider names.
      const oldByName = Object.fromEntries(
        (settings.providers || []).map((p) => [p.name, p])
      );
      remote.providers = (remote.providers || []).map((p) => {
        if (!p.key && oldByName[p.name]) p.key = oldByName[p.name].key;
        return p;
      });
      settings = { ...settings, ...remote };
      store.saveSettings(settings);
      markAllSaved();
      render();
    } catch {
      // ignore — offline / no KV is fine
    }
  }

  // Snapshot whatever was loaded from localStorage, so freshly displayed
  // providers don't immediately appear "未保存".
  markAllSaved();
  render();
  bootstrapFromRemote();
})();
