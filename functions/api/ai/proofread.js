import {
  json,
  error,
  authorize,
  findProvider,
  aiComplete,
} from "../../_shared.js";

const DEFAULT_SYS = `你是一位严格的物理教材审稿人。请检查给定 LaTeX 片段中的物理概念准确性、公式推导正确性、例题解析逻辑、习题答案正确性、单位与符号一致性、表述清晰度。
以 JSON 数组形式输出改进建议，每条包含：
- "location": 出现位置（如"知识讲解第3段"或"例题2第2步"）
- "issue": 问题简述
- "suggestion": 改进建议
- "patch": 建议替换为的 LaTeX 片段（如适用，可省略）
不要输出 JSON 以外的任何内容。`;

export const onRequestPost = async ({ request, env }) => {
  const auth = await authorize(request, env);
  if (!auth.ok) return error(auth.error, auth.status);

  const body = await request.json().catch(() => ({}));
  const provider = findProvider(auth.settings, body.provider);
  if (!provider) return error("提供商未配置: " + body.provider, 400);

  const sys = body.system && body.system.trim() ? body.system : DEFAULT_SYS;
  const user = (body.targets && body.targets.length
    ? "请重点检查：" + body.targets.join("、") + "。\n\n"
    : "") + (body.latex || "");
  try {
    const r = await aiComplete({
      provider,
      system: sys,
      user,
      max_tokens: 0,
      temperature: 0.1,
    });
    return json({ content: r.content });
  } catch (e) {
    return error(e.message, 502);
  }
};
