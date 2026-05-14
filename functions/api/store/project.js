import {
  json,
  error,
  authorize,
  kvGet,
  kvPut,
} from "../../_shared.js";

const key = (id) => "project:" + id;

export const onRequestGet = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return error("缺少 id");
  const p = await kvGet(env, key(id));
  if (!p) return error("不存在", 404);
  return json(p);
};

export const onRequestPut = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return error("缺少 id");
  let project;
  try {
    project = await request.json();
  } catch {
    return error("非法 JSON");
  }
  project.updatedAt = Date.now();
  await kvPut(env, key(id), project);
  return json({ ok: true, updatedAt: project.updatedAt });
};
