# LaTeX 写书协作平台 (bookprojectphysics)

基于 Cloudflare Pages 的 AI 辅助 LaTeX 写书工具。多人共享、批量生成、模板合并、多 AI 校对、灵活导出。

## 功能

1. **AI 生成全书**
   - 参考资料：直接粘贴文本 / 上传 PDF / 给定 URL，由 AI 提取结构化摘要
   - 用户填写章节大纲，按节并发调用 AI 生成 `知识讲解 + 例题 + 习题`（可选择只生成其中一类）
   - 每节支持单独重生成
2. **后台齿轮设置 `/settings`**
   - 任意数量 AI 提供商：OpenAI 兼容 / Anthropic / Google Gemini
   - 模型、Base URL、Key、温度、最大 tokens
   - 默认调用：写作、解析、校对（校对可多选多家 AI）
   - 一键连通性测试
3. **模板设置**
   - 文档类（ctexbook/ctexart/book/article）、纸张选项、字体
   - 宏包清单、定理环境、自定义 preamble
   - 实时预览 preamble
4. **LaTeX 导出**
   - 完整书（preamble + document）
   - 仅 `\begin{document} ... \end{document}` 内部
   - 仅 preamble
   - 单题（任意一道例题或习题，含解析）
5. **多文件合并**
   - 上传多份 `.tex`，自动剥离每份的 documentclass/preamble，仅保留 body，统一套用当前模板，输出一个可编译的 `.tex`
6. **多 AI 校对**
   - 选定章节、选定校对目标（知识/例题/习题），并行调用多个 AI 提供商
   - 每条建议含 `位置 / 问题 / 建议 / patch`
   - 一键追加 / 替换 / 忽略
7. **PDF 翻译 → 中文成书**
   - 浏览器端用 pdf.js 解析大 PDF（不上传到服务器）
   - 自动按章节标题或定长字符切块；每块可手改标题
   - 选定写作 AI 提供商，按批次（默认 1 块/批）调用 AI 翻译并改写为中文 LaTeX 教辅章节
   - 每批完成自动暂停 → 可预览每块的原文与 AI 输出 → 点"继续"运行下一批
   - 勾选**自动模式**后全程不暂停，直到整本 PDF 处理完
   - 失败的块可单独"重试"，无关的块可"跳过"；完成的块"跳到写作"直接定位到对应章节
   - 状态会随项目存到 KV，同事打开同一项目 ID 可看到进度并继续
8. **图片 / 插图**
   - 每节带"插图"区，支持上传任意格式（JPG/WEBP/SVG/AVIF/...），浏览器端 Canvas 自动转 PNG 后存到 KV
   - **AI 文生图**（OpenAI `gpt-image-1`/`dall-e-3`、Gemini `imagen-3.0-generate-001`）
   - 一键插入到知识讲解末尾、任一例题或习题位置（自动产出 `\begin{figure}...\includegraphics{images/<id>.png}...\end{figure}`）
   - 任意时刻可上传新图替换旧图（保持同一 id，文中引用不用改）
   - 导出新增 **ZIP** 模式：`book.tex` + `images/` 目录，解压即可 `xelatex` 编译
9. **多人协作**
   - 顶部输入「项目 ID」+ 后台「共享 Token」即可在 Cloudflare KV 中共享同一项目
   - 本地 localStorage 兜底；保存/载入自动取最新

## 部署到 Cloudflare Pages

> **重要：本项目不含 `wrangler.toml`。** 这是刻意的 —— 只要项目里存在
> `wrangler.toml`，Cloudflare 就会**完全忽略 Dashboard 里配置的 binding**，
> 以该文件为准。删掉它之后，你才能在 Cloudflare 网页界面里正常配置 KV
> binding。请不要再把 `wrangler.toml` 加回来。

### 1. 创建 KV namespace

Cloudflare Dashboard → **Storage & Databases → KV → Create a namespace**，
名字随意（例如 `bookprojectphysics-kv`）。

或用命令行：

```
npx wrangler kv namespace create BOOK_KV
```

### 2. 关联到 Pages 项目

1. **Workers & Pages → Create → Pages → Connect to Git**，选择本仓库
2. 构建命令（Build command）：留空
3. 构建输出目录（Build output directory）：`/`
4. 部署一次

### 3. 绑定 KV（关键步骤）

项目 → **Settings → Bindings → Add → KV namespace**：

- **Variable name**：`BOOK_KV`（必须完全一致，区分大小写）
- **KV namespace**：选第 1 步创建的那个

保存后，到 **Deployments** 重新部署一次（Retry deployment），让 binding 生效。

> 验证：访问 `https://<你的域名>/api/health`，返回 `{"ok":true,"kv":true,...}`
> 中的 **`kv:true`** 才说明绑定成功。设置页顶部若出现红色 KV 警告横幅，
> 说明还没绑好。

### 4. 第一次访问

1. 打开站点首页，点右上角齿轮 `⚙` 进入设置
2. **首次保存** 时设置一个共享 Token —— 之后服务端会要求所有调用携带此 Token
3. 添加 AI 提供商，点「保存」「测试」
4. 回主页，输入项目 ID（任意字符串，团队约定），开始写作

> 即使没有配置 KV，前端也能用 localStorage 单机使用；但 AI 调用会因为
> 设置无法跨请求保存而报「提供商未配置」，所以**生产部署务必绑定 KV**。

## 本地开发

```bash
npm install
npm run dev      # wrangler pages dev . --kv BOOK_KV
```

打开 `http://127.0.0.1:8788`。本地 `--kv BOOK_KV` 会创建一个本地 KV，
数据存在 `.wrangler/` 里。

## 目录结构

```
.
├── index.html                # 主页（写作 / 模板 / 合并 / 校对 / 导出）
├── settings.html             # 齿轮后台
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── storage.js        # 本地 + 远端项目存储
│       ├── ai-client.js      # 浏览器侧 AI 调用封装（通过本站代理）
│       ├── images.js         # 图片上传 / Canvas 转 PNG / AI 文生图 / 插入
│       ├── pdf-translate.js  # PDF 解析 / 切块 / 分批翻译流水线
│       ├── latex.js          # preamble 构建 + 合并器
│       ├── app.js            # 主页所有逻辑
│       └── settings-page.js  # 后台齿轮逻辑
├── functions/
│   ├── _shared.js            # KV / 鉴权 / 各 provider 统一 completion
│   └── api/
│       ├── health.js
│       ├── ai/
│       │   ├── generate.js   # 生成内容
│       │   ├── parse.js      # 解析参考资料（含 PDF/URL）
│       │   ├── proofread.js  # 校对
│       │   ├── image.js      # 文生图（OpenAI / Gemini）
│       │   └── test.js       # 提供商连通性
│       ├── latex/merge.js    # 服务端 LaTeX 合并（备用）
│       └── store/
│           ├── settings.js   # 全局设置 KV 读写
│           ├── project.js    # 项目数据 KV 读写
│           └── image.js      # 二进制图片 KV 读写
├── _headers
└── _redirects
```

> 注意：本项目**故意不包含 `wrangler.toml`**。见上方「部署」一节的说明。

## 工作流示例

1. **物理老师 A** 部署站点 → 打开 `/settings.html` → 添加 `openai-gpt4o` + `anthropic-claude` 两个提供商 → 写入共享 Token `physics2026` → 把 Token 通过聊天告诉同事
2. A 在主页输入项目 ID `mechanics-2026` → 填写大纲（`第1章 运动学/匀变速...`）→ 在「参考资料」粘贴教学大纲文本，点 **AI 解析** → 点 **分批生成全书**
3. **物理老师 B** 打开站点 → 进入设置粘贴 Token → 回到主页输入相同 ID `mechanics-2026` → 点 **载入** → 看到 A 写的所有章节，可继续编辑
4. 完成后切到「校对」选所有章节 + 三个 AI → 提交，逐条审查 AI 给的建议、一键接受
5. 切到「导出」选「完整书」→ 下载 `.tex` → 本地 `xelatex` 编译

## 安全提示

- API Key 通过 `/api/store/settings` 存入 Cloudflare KV。所有第三方 AI 调用都在服务端（Pages Functions）发起，浏览器只发送提供商名字、不直接持有 Key 去打第三方接口
- `GET /api/store/settings` 会把 Key 一并返回给**已通过共享 Token 鉴权**的客户端（设置页需要它来回显/编辑配置而不必每次重输 Key）。安全模型是：**共享 Token 即凭证** —— 持有 Token 的人本来就能通过代理使用所有 Key，因此能读到 Key 本身并不构成额外的权限提升
- 设置共享 Token 后，所有 `/api/*` 端点都需要 `x-share-token` 才能调用；同事必须从你这里拿到 Token 才能加入
- 首次保存设置时 Token 为空可作为「引导」，请尽快设置 Token 防止被陌生人调用

## License

MIT —— see [LICENSE](./LICENSE)
