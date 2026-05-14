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

  let settings = store.loadSettings();

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
    };
  }

  function render() {
    const list = $("#providerList");
    list.innerHTML = "";
    settings.providers = settings.providers || [];
    settings.providers.forEach((p, i) => list.appendChild(buildCard(p, i)));
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
    const setDefaultBase = () => {
      if (fields.base.value) return;
      const map = {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com/v1",
        gemini: "https://generativelanguage.googleapis.com/v1beta",
      };
      fields.base.value = map[fields.type.value] || "";
    };
    fields.type.addEventListener("change", setDefaultBase);
    if (!p.base) setDefaultBase();
    const sync = () => {
      settings.providers[idx] = {
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
    };
    root.addEventListener("input", sync);
    root.addEventListener("change", sync);
    tpl.querySelector(".p-del").addEventListener("click", async () => {
      if (!confirm("删除此提供商？")) return;
      settings.providers.splice(idx, 1);
      persist();
      render();
    });
    tpl.querySelector(".p-test").addEventListener("click", async () => {
      const status = root.querySelector(".p-status");
      status.textContent = "测试中...";
      status.style.color = "";
      try {
        persist();
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
        if (res && res.ok) {
          status.textContent = "✓ 连通：" + (res.sample || "OK");
          status.style.color = "var(--ok)";
        } else {
          status.textContent = "✗ " + (res && res.error ? res.error : "失败");
          status.style.color = "var(--danger)";
        }
      } catch (e) {
        status.textContent = "✗ " + e.message;
        status.style.color = "var(--danger)";
      }
    });
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

  function persist() {
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
    // Push to server too so coworkers can pull these via the token.
    if (settings.shareToken) {
      fetch("/api/store/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-share-token": settings.shareToken,
        },
        body: JSON.stringify(settings),
      }).catch(() => {});
    }
  }

  $("#addProvider").addEventListener("click", () => {
    settings.providers = settings.providers || [];
    settings.providers.push(newProvider());
    persist();
    render();
  });
  $("#testAll").addEventListener("click", async () => {
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
  $("#saveDefaults").addEventListener("click", () => {
    persist();
    toast("已保存默认配置", "ok");
  });
  $("#saveShare").addEventListener("click", () => {
    persist();
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
      render();
    } catch {
      // ignore — offline / no KV is fine
    }
  }

  render();
  bootstrapFromRemote();
})();
