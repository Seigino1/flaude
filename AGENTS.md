# AGENTS.md

## 执行框架：Playbooks → Scripts

两层分工：`playbooks/` 描述流程与判断，`scripts/` 执行确定性操作。

- Playbook = 协调层，含目的、前提条件、步骤、判断标准、验证五个章节
- Script = 执行层，单一职责，相同输入→相同输出，无 AI 调用或随机逻辑

逻辑固定或会重复执行 → Script；需要上下文理解或主观判断 → Playbook。

## 目录结构

```text
AGENTS.md
playbooks/
scripts/
src/
.tmp/
```

## 执行规则

1. 接到任务先查 `playbooks/`。
2. 直接命令行调用 Script，不在代码中模拟 Script 行为。
3. 新建 Script 须可独立运行和测试。
4. 临时文件放 `.tmp/`，不要提交真实 Claude 导出数据。
