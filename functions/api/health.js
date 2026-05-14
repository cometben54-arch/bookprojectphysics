import { json } from "../_shared.js";

export const onRequestGet = ({ env }) =>
  json({
    ok: true,
    kv: !!(env && env.BOOK_KV),
    time: Date.now(),
  });
