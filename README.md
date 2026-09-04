# table-workflows

一个面向非技术用户的通用表格工作流 Skill。

它引导用户提供一张或多张源表、人工确认正确的历史结果表，以及可选的空白结果模板；再由使用者自己的 Agent 推导、验证并沉淀可重复运行的脚本或 DSL。Skill 本身不内置考勤、财务等具体业务规则。

## 安装

### 安装到单个项目

将 `.agents/skills/spreadsheet-workflow` 复制到目标项目的同名目录：

```text
<target-project>/.agents/skills/spreadsheet-workflow
```

### 安装为个人 Skill

将该目录复制到：

```text
~/.agents/skills/spreadsheet-workflow
```

在 Codex 中，也可以让 `$skill-installer` 从本仓库的 `.agents/skills/spreadsheet-workflow` 路径安装。

## 使用

在支持 Agent Skills 的 Agent 中调用：

```text
$spreadsheet-workflow

我有几张源表和一份人工确认正确的历史结果表，请引导我创建一个以后可以重复使用的表格任务模板。
```

首次创建时，Agent 会引导用户确认输入、输出、字段含义、匹配关系和验收标准。验证通过后，生成的任务模板默认保存在当前业务项目的 `.table-workflows/<workflow-id>/` 中。以后运行时选择已有模板并上传当期源表即可。

## 数据边界

- 本仓库只提供通用流程、格式约定和验证方法。
- 用户生成的规则、脚本、DSL 和运行记录保存在用户自己的业务项目中。
- 不要将含敏感数据的 `.table-workflows` 目录直接提交到本仓库。

## 仓库结构

```text
.agents/skills/spreadsheet-workflow/
├── SKILL.md
├── agents/openai.yaml
└── references/
```
