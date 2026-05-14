// Image utilities: PNG conversion (Canvas), upload/download to /api/store/image,
// AI generation, and a LaTeX figure-snippet helper.

(function (global) {
  function newId() {
    return (
      "img_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  // Convert any browser-decodable image (jpg/webp/avif/gif/bmp/svg/png) into
  // a PNG Blob using <canvas>. Returns { blob, width, height }.
  async function fileToPng(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("无法解码该图片"));
        i.src = url;
      });
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error("图片尺寸为 0");
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise((res) =>
        c.toBlob(res, "image/png", 0.92)
      );
      if (!blob) throw new Error("PNG 转换失败");
      return { blob, width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function b64ToPngBlob(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const inputBlob = new Blob([u], { type: "image/png" });
    // If it's already PNG we still pass through canvas to normalise.
    const fakeFile = new File([inputBlob], "ai.png", { type: "image/png" });
    return await fileToPng(fakeFile);
  }

  function authHeaders() {
    const s = global.BPPX.storage.loadSettings();
    return s.shareToken ? { "x-share-token": s.shareToken } : {};
  }

  async function uploadPng(projectId, id, blob, meta) {
    const headers = {
      "content-type": "image/png",
      "x-name": encodeURIComponent(meta.name || id + ".png"),
      "x-caption": encodeURIComponent(meta.caption || ""),
      ...authHeaders(),
    };
    const r = await fetch(
      "/api/store/image?projectId=" +
        encodeURIComponent(projectId) +
        "&id=" +
        encodeURIComponent(id),
      { method: "POST", headers, body: blob }
    );
    if (!r.ok) {
      const t = await r.text();
      throw new Error("上传失败：" + t);
    }
    return await r.json();
  }

  async function deleteImage(projectId, id) {
    const r = await fetch(
      "/api/store/image?projectId=" +
        encodeURIComponent(projectId) +
        "&id=" +
        encodeURIComponent(id),
      { method: "DELETE", headers: authHeaders() }
    );
    if (!r.ok) throw new Error("删除失败");
    return true;
  }

  function imageUrl(projectId, id) {
    // GET endpoint is auth-checked too, but browser <img> can't add custom
    // headers. If a shareToken is required and you want secured images,
    // wrap this with a fetch + blob URL fallback.
    return (
      "/api/store/image?projectId=" +
      encodeURIComponent(projectId) +
      "&id=" +
      encodeURIComponent(id)
    );
  }

  // Token-aware blob URL: when a shareToken is set, regular <img src=...>
  // won't pass it. Use this for secured image previews.
  async function fetchImageBlobUrl(projectId, id) {
    const r = await fetch(imageUrl(projectId, id), { headers: authHeaders() });
    if (!r.ok) return null;
    const b = await r.blob();
    return URL.createObjectURL(b);
  }

  async function generate(prompt, opts = {}) {
    const settings = global.BPPX.storage.loadSettings();
    const provider = opts.provider || settings.image;
    if (!provider) throw new Error("未在设置选择文生图提供商");
    const r = await fetch("/api/ai/image", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        provider,
        prompt,
        size: opts.size || "1024x1024",
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      let msg = t;
      try {
        msg = JSON.parse(t).error || t;
      } catch {}
      throw new Error(msg);
    }
    const j = await r.json();
    if (!j.b64) throw new Error("无图像数据返回");
    return await b64ToPngBlob(j.b64);
  }

  function figureSnippet(id, caption, width = "0.6") {
    const cap = (caption || "").replace(/[{}]/g, "");
    return [
      "\\begin{figure}[h]",
      "  \\centering",
      `  \\includegraphics[width=${width}\\textwidth]{images/${id}.png}`,
      ...(cap ? [`  \\caption{${cap}}`] : []),
      `  \\label{fig:${id}}`,
      "\\end{figure}",
      "",
    ].join("\n");
  }

  // Pull every imageId referenced from a string of LaTeX content.
  function extractRefs(latex) {
    const out = new Set();
    if (!latex) return out;
    const re = /images\/([A-Za-z0-9_\-]+)\.png/g;
    let m;
    while ((m = re.exec(latex))) out.add(m[1]);
    return out;
  }

  global.BPPX = global.BPPX || {};
  global.BPPX.images = {
    newId,
    fileToPng,
    b64ToPngBlob,
    uploadPng,
    deleteImage,
    imageUrl,
    fetchImageBlobUrl,
    generate,
    figureSnippet,
    extractRefs,
  };
})(window);
