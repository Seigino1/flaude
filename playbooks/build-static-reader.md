# Playbook: 构建静态阅读器

## 目的
把一个 Claude 导出目录转换为可本地打开或部署的静态阅读器。

## 前提条件
- 已安装 Python 3
- Claude 导出目录存在
- 导出目录包含 `conversations.json`

## 步骤
1. `python3 scripts/build_claude_reader.py "/path/to/claude-export" dist` — 生成静态阅读器到 `dist/`
2. `python3 -m http.server 8765 --directory dist` — 本地预览

## 判断标准
- 只想本地临时阅读 → 直接运行 `npm start` 后在网页里添加文件夹
- 想部署或分享固定快照 → 使用构建脚本生成 `dist/`

## 验证
- 页面能打开
- 左侧数量正确
- 对话、项目、记忆可以切换
- 搜索可用
- 附件里的 Markdown / HTML 可以打开或下载
