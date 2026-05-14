// Local + remote storage helpers shared by all pages.
// Strategy:
//   - settings (providers, defaults, shareToken) live in localStorage
//     AND are pushed to the server (KV) when shareToken is set, so a coworker
//     opening the same project on a new machine can pull the same config.
//   - project data (book, sections, template) is keyed by projectId and lives
//     in localStorage + server (KV). Anyone with the project ID and the
//     correct token can load/save.

(function (global) {
  const LS = {
    SETTINGS: "bppx.settings.v1",
    PROJECT_LAST: "bppx.lastProjectId",
    PROJECT: (id) => "bppx.project." + id,
  };

  const DEFAULTS = {
    providers: [],
    write: "",
    parse: "",
    image: "",
    proof: [],
    timeout: 120,
    concurrency: 2,
    sysWrite: "",
    sysProof: "",
    shareToken: "",
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS.SETTINGS);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(LS.SETTINGS, JSON.stringify(s));
  }

  function emptyProject() {
    return {
      title: "",
      author: "",
      level: "高中",
      outline: "",
      refText: "",
      refSummary: "",
      sections: [], // [{title, knowledge, examples:[{q,sol}], exercises:[{q,a}], images:[{id,name,caption}]}]
      template: {
        docClass: "ctexbook",
        opts: "UTF8,a4paper,11pt,oneside",
        font: "Times New Roman",
        pkgs: "amsmath,amssymb,amsthm,physics,siunitx,graphicx,xcolor,hyperref,enumitem,booktabs,tikz,pgfplots",
        theorems:
          "\\newtheorem{example}{例题}[section]\n\\newtheorem{exercise}{习题}[section]\n\\theoremstyle{remark}\n\\newtheorem*{solution}{解}\n\\newtheorem*{note}{注}",
        extra: "",
      },
      updatedAt: 0,
    };
  }

  function loadLocalProject(id) {
    try {
      const raw = localStorage.getItem(LS.PROJECT(id));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function saveLocalProject(id, project) {
    project.updatedAt = Date.now();
    localStorage.setItem(LS.PROJECT(id), JSON.stringify(project));
    localStorage.setItem(LS.PROJECT_LAST, id);
  }
  function lastProjectId() {
    return localStorage.getItem(LS.PROJECT_LAST) || "";
  }

  async function fetchRemoteProject(id, token) {
    const r = await fetch(
      "/api/store/project?id=" + encodeURIComponent(id),
      { headers: token ? { "x-share-token": token } : {} }
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("加载失败: " + r.status);
    return await r.json();
  }
  async function pushRemoteProject(id, token, project) {
    const r = await fetch(
      "/api/store/project?id=" + encodeURIComponent(id),
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-share-token": token } : {}),
        },
        body: JSON.stringify(project),
      }
    );
    if (!r.ok) throw new Error("保存失败: " + r.status);
    return await r.json();
  }

  // Pick newer (remote vs local) by updatedAt; null-safe.
  function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
  }

  global.BPPX = global.BPPX || {};
  global.BPPX.storage = {
    loadSettings,
    saveSettings,
    emptyProject,
    loadLocalProject,
    saveLocalProject,
    lastProjectId,
    fetchRemoteProject,
    pushRemoteProject,
    pickNewer,
  };
})(window);
