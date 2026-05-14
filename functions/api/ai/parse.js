import {
  json,
  error,
  authorize,
  findProvider,
  aiComplete,
} from "../../_shared.js";

// Take a piece of reference material (text / pdf base64 / url) and have the AI
// produce a structured summary the writer can use as grounding. PDF text
// extraction is best-effort: we look for the PDF text stream markers and pull
// out anything that decodes to UTF-8. For high-fidelity extraction in
// production, swap this for a real PDF parser like pdf.js / pdfjs-dist.

const SYS = `你是教材编辑助手。请将给定参考材料整理成可供后续 AI 写作引用的结构化摘要：
- 主题与适用学段
- 核心概念清单（每条一句话解释）
- 重要公式（LaTeX）
- 典型例题骨架（题干+一句话解题思路）
- 常见易错点
- 推荐章节大纲

直接输出 Markdown，不要任何前言。`;

async function fetchUrl(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error("抓取链接失败: " + r.status);
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("pdf")) {
    const ab = await r.arrayBuffer();
    return extractPdfText(new Uint8Array(ab));
  }
  const text = await r.text();
  // strip HTML tags crudely
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

function extractPdfText(bytes) {
  // Very rough fallback: pull anything between BT...ET text objects and
  // ASCII-decode it. Good enough to feed an LLM as a "reference dump".
  const str = new TextDecoder("latin1").decode(bytes);
  const chunks = [];
  const re = /\(([^()\\]{2,})\)\s*Tj/g;
  let m;
  while ((m = re.exec(str))) chunks.push(m[1]);
  let out = chunks.join("\n");
  if (!out) {
    // Try stream text
    const re2 = /stream\s*([\s\S]*?)\s*endstream/g;
    while ((m = re2.exec(str))) {
      const ascii = m[1].replace(/[^\x20-\x7E\n\r]+/g, " ");
      if (ascii.length > 200) out += "\n" + ascii;
    }
  }
  return out.slice(0, 40000);
}

function b64decode(s) {
  // Cloudflare Workers atob exists.
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);

  const body = await request.json().catch(() => ({}));
  const provider = findProvider(auth.settings, body.provider);
  if (!provider) return error("提供商未配置: " + body.provider, 400);

  let payload = "";
  try {
    if (body.kind === "text") payload = String(body.payload || "");
    else if (body.kind === "url") payload = await fetchUrl(body.payload);
    else if (body.kind === "pdf") payload = extractPdfText(b64decode(body.payload));
    else return error("未知 kind: " + body.kind);
  } catch (e) {
    return error("参考资料解析失败：" + e.message, 400);
  }
  if (!payload.trim()) return error("参考资料为空");

  try {
    const r = await aiComplete({
      provider,
      system: SYS,
      user: payload.slice(0, 30000),
      max_tokens: 0,
      temperature: 0.2,
    });
    return json({ content: r.content });
  } catch (e) {
    return error(e.message, 502);
  }
};
