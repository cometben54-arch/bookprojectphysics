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

### 1. 在 Cloudflare Dashboard 创建 KV namespace

```
wrangler kv:namespace create BOOK_KV
```

复制返回的 `id`，填入 `wrangler.toml` 中 `REPLACE_WITH_REAL_KV_ID` 的位置。

### 2. 关联到 Pages 项目

在 Cloudflare Dashboard：

1. **Pages → Create project → Connect to Git**，选择本仓库
2. 构建命令：留空（纯静态）
3. 输出目录：`/`
4. **Settings → Functions → KV namespace bindings**：添加 `BOOK_KV` 绑定到上一步创建的 namespace
5. 部署

### 3. 第一次访问

1. 打开站点首页，点击右上角齿轮 `⚙` 进入设置
2. **首次保存** 时设置一个共享 Token —— 之后服务端会要求所有调用携带此 Token
3. 添加 AI 提供商，点击「测试」确认连通性
4. 回到主页，输入项目 ID（任意字符串，团队约定），开始写作

> 即使没有配置 KV，前端也能用 localStorage 单机使用；只是同事之间无法共享。

## 本地开发

```bash
npm install
npm run dev      # wrangler pages dev
```

打开 `http://127.0.0.1:8788`。本地未绑定 KV 时使用内存兜底，重启会丢数据。

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
├── wrangler.toml
├── _headers
└── _redirects
```

## 工作流示例

1. **物理老师 A** 部署站点 → 打开 `/settings.html` → 添加 `openai-gpt4o` + `anthropic-claude` 两个提供商 → 写入共享 Token `physics2026` → 把 Token 通过聊天告诉同事
2. A 在主页输入项目 ID `mechanics-2026` → 填写大纲（`第1章 运动学/匀变速...`）→ 在「参考资料」粘贴教学大纲文本，点 **AI 解析** → 点 **分批生成全书**
3. **物理老师 B** 打开站点 → 进入设置粘贴 Token → 回到主页输入相同 ID `mechanics-2026` → 点 **载入** → 看到 A 写的所有章节，可继续编辑
4. 完成后切到「校对」选所有章节 + 三个 AI → 提交，逐条审查 AI 给的建议、一键接受
5. 切到「导出」选「完整书」→ 下载 `.tex` → 本地 `xelatex` 编译

## 安全提示

- API Key 通过 `/api/store/settings` 存入 Cloudflare KV，仅在服务端被读取后用于调用第三方 AI；浏览器代码不会拿到原始 Key（GET 接口已剥除）
- 设置共享 Token 后，所有 `/api/*` 端点都需要 `x-share-token` 才能调用；同事必须从你这里拿到 Token 才能加入
- 首次保存设置时 Token 为空可作为「引导」，请尽快设置 Token 防止被陌生人调用

## License

MIT —— see [LICENSE](./LICENSE)
