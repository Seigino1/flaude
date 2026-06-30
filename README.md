<p align="center">
  <img src="./src/claude_reader/logo.svg" alt="Flaude" width="520" />
</p>

# Flaude｜Claude 导出文档阅读器

一个收留最近被 Claude 封号的伤心人的小工具。

如果你的 Claude 账号突然没了，至少导出的数据别再跟着消失。Flaude 可以帮你把 Claude 导出文件夹放进一个本地阅读器里，快速查看、搜索、复制、下载以前的对话、项目资料、记忆和附件。

我还是很喜欢 Claude 的。这个项目不是为了骂它，而是给大家在等待解封、申诉、迁移资料的时候留一条比较体面的后路。希望大家都早日解封。

[Build with Codex](https://chatgpt.com/codex/).

## 能做什么

- 选择 Claude 导出文件夹后，在浏览器本地完成解析。
- 查看历史对话、项目、记忆、设计对话和附件内容。
- 搜索标题、正文、附件和文件名。
- 快速复制单条消息或整段对话。
- 下载消息、对话和附件内容。
- 自动折叠 Claude 回复开头的大段思考过程，把结果优先露出来。
- 对话、思考过程、工具调用、附件、文件引用都可以单独展开和折叠。
- 支持 Markdown 表格、代码块和常见文本附件。

## 隐私

默认使用方式是本地解析：文件夹只在你的浏览器里读取，不上传到服务器。

请不要把自己的 Claude 导出数据提交到公开仓库。`.gitignore` 已经忽略 `dist/`、`.tmp/`、`claude-data.json` 和生成的附件文件，但提交前还是建议自己再看一眼。

## 直接使用

启动一个本地静态服务：

```bash
python3 -m http.server --directory src/claude_reader 8765
```

打开：

```text
http://localhost:8765
```

点击左侧「添加文件夹」，选择 Claude 导出的根目录。这个目录通常包含：

```text
conversations.json
projects/
memories.json
users.json
```

也可以用 npm：

```bash
npm start
```

## 预构建静态阅读器

如果你想把某份导出预先打包成一个可直接打开的静态阅读器：

```bash
python3 scripts/build_claude_reader.py "/path/to/claude-export" dist
python3 -m http.server --directory dist 8765
```

`dist/` 会包含页面文件、数据文件，以及从附件里导出的可点击 Markdown / HTML 文件。

用 npm 也可以：

```bash
npm run build:reader -- "/path/to/claude-export" dist
```

## 欢迎帮忙更新

这个项目现在还是一个很轻的小工具，欢迎大家一起补：

- 更多 Claude 导出格式兼容
- 更好的思考过程识别
- 更好的附件预览
- 更舒服的搜索和筛选
- 更漂亮的界面
- 英文 README / 多语言支持

如果你也刚经历账号风控、封号、导出资料、到处找旧对话的那种慌张感，欢迎提交 issue 或 PR。我们先把资料安顿好，再慢慢等好消息。

## 项目结构

```text
src/claude_reader/        # 静态阅读器源码
scripts/build_claude_reader.py
playbooks/                # 维护流程说明
```
