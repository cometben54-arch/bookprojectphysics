import {
  json,
  error,
  authorize,
  findProvider,
  readResponse,
  describeHttpError,
  geminiBase,
} from "../../_shared.js";

// Generate an image from a text prompt using the chosen provider.
// Returns base64 PNG so the browser can decide whether to display or upload
// it back into the project's image store.
//
// Supported provider types:
//   - openai (uses /images/generations; needs an image-capable model like
//     "gpt-image-1" or "dall-e-3" — set provider.imageModel, falls back to
//     provider.model)
//   - gemini (uses imagen via :predict; e.g. "imagen-3.0-generate-001"
//     — set provider.imageModel)

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}

async function fetchUrlAsB64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("拉取图像失败：" + r.status);
  const ab = await r.arrayBuffer();
  return bytesToB64(ab);
}

async function genOpenAI(provider, prompt, size) {
  const base = (provider.base || "").replace(/\/+$/, "");
  const model = provider.imageModel || provider.model;
  if (!model)
    throw new Error("未设置图像模型（在该提供商的『图像模型』栏填 gpt-image-1 等）");
  let r;
  try {
    r = await fetch(base + "/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + (provider.key || ""),
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: size || "1024x1024",
        response_format: "b64_json",
      }),
    });
  } catch (e) {
    throw new Error("OpenAI 网络错误：" + (e.message || e) + "（检查 Base URL）");
  }
  const res = await readResponse(r);
  if (!res.ok) throw new Error(describeHttpError("OpenAI 图像", res));
  const j = res.json || {};
  const item = j.data?.[0] || {};
  if (item.b64_json) return item.b64_json;
  if (item.url) return await fetchUrlAsB64(item.url);
  throw new Error("OpenAI 未返回图像数据：" + JSON.stringify(j).slice(0, 300));
}

async function genGemini(provider, prompt, size) {
  const model = provider.imageModel || provider.model;
  if (!model)
    throw new Error(
      "未设置图像模型（在该提供商的『图像模型』栏填 imagen-3.0-generate-001 等）"
    );
  const url =
    geminiBase(provider.base) +
    "/models/" +
    encodeURIComponent(model) +
    ":predict?key=" +
    encodeURIComponent(provider.key || "");
  const aspect = size && size.includes("x")
    ? (() => {
        const [w, h] = size.split("x").map(Number);
        if (w === h) return "1:1";
        if (w > h) return "16:9";
        return "9:16";
      })()
    : "1:1";
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: aspect },
      }),
    });
  } catch (e) {
    throw new Error("Gemini 网络错误：" + (e.message || e) + "（检查 Base URL）");
  }
  const res = await readResponse(r);
  if (!res.ok) throw new Error(describeHttpError("Gemini 图像", res));
  const j = res.json || {};
  const pred = j.predictions?.[0] || {};
  const b64 = pred.bytesBase64Encoded || pred.image?.bytesBase64Encoded;
  if (!b64)
    throw new Error(
      "Gemini 未返回图像数据：" + JSON.stringify(j).slice(0, 300)
    );
  return b64;
}

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const body = await request.json().catch(() => ({}));
  const provider = findProvider(auth.settings, body.provider);
  if (!provider) return error("提供商未配置: " + body.provider, 400);
  const prompt = (body.prompt || "").trim();
  if (!prompt) return error("提示词为空");

  try {
    let b64;
    if (provider.type === "openai") b64 = await genOpenAI(provider, prompt, body.size);
    else if (provider.type === "gemini")
      b64 = await genGemini(provider, prompt, body.size);
    else
      return error(
        "提供商类型 " + provider.type + " 不支持图像生成（请使用 OpenAI 或 Gemini）"
      );
    return json({ b64, mime: "image/png" });
  } catch (e) {
    return error(e.message || String(e), 502);
  }
};
