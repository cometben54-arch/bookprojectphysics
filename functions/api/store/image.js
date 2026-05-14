import {
  json,
  error,
  authorize,
  kvPutBytes,
  kvGetBytes,
  kvDel,
  kvList,
} from "../../_shared.js";

// /api/store/image
//   GET    ?projectId=...&id=...    -> image bytes (image/png)
//   GET    ?projectId=...           -> list metadata for the project
//   POST   ?projectId=...&id=...    -> upload PNG bytes (raw body)
//                                      headers: x-name, x-caption (URI-encoded)
//   DELETE ?projectId=...&id=...

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB hard cap

const k = (projectId, imgId) =>
  "image:" + projectId + (imgId ? ":" + imgId : ":");

function parse(url) {
  const u = new URL(url);
  return {
    projectId: u.searchParams.get("projectId"),
    id: u.searchParams.get("id"),
  };
}

export const onRequestGet = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const { projectId, id } = parse(request.url);
  if (!projectId) return error("缺少 projectId");

  if (!id) {
    // List
    const prefix = k(projectId, "");
    const keys = await kvList(env, prefix);
    return json({
      images: keys.map((row) => ({
        id: row.name.slice(prefix.length),
        ...(row.metadata || {}),
      })),
    });
  }

  const got = await kvGetBytes(env, k(projectId, id));
  if (!got) return error("不存在", 404);
  const meta = got.metadata || {};
  return new Response(got.bytes, {
    headers: {
      "content-type": meta.mime || "image/png",
      "cache-control": "public, max-age=300",
      "x-image-name": encodeURIComponent(meta.name || ""),
      "x-image-caption": encodeURIComponent(meta.caption || ""),
    },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const { projectId, id } = parse(request.url);
  if (!projectId || !id) return error("缺少 projectId / id");

  const ct = request.headers.get("content-type") || "image/png";
  if (!ct.startsWith("image/")) return error("仅接受 image/* 内容");

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return error("空请求体");
  if (buf.byteLength > MAX_BYTES)
    return error("图片过大（>8MB），请压缩后再上传", 413);

  const meta = {
    mime: ct,
    name: decodeURIComponent(request.headers.get("x-name") || "image.png"),
    caption: decodeURIComponent(request.headers.get("x-caption") || ""),
    size: buf.byteLength,
    createdAt: Date.now(),
  };
  await kvPutBytes(env, k(projectId, id), buf, meta);
  return json({ ok: true, id, ...meta });
};

export const onRequestDelete = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const { projectId, id } = parse(request.url);
  if (!projectId || !id) return error("缺少 projectId / id");
  await kvDel(env, k(projectId, id));
  return json({ ok: true });
};
