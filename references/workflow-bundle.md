# 任务模板协议 v0.1

“任务模板”是一套可执行、可验证、可版本化的表格工作流；“结果模板”是某次输出所使用的电子表格结构。两者不能混称。

## 默认目录

动态任务模板不得写入 Skill 目录。默认保存在当前工作区：

```text
.table-workflows/
└── <workflow-id>/
    ├── manifest.json
    ├── versions/
    │   ├── v0001/
    │   │   ├── version-manifest.json
    │   │   ├── implementation files
    │   │   └── structure/
    │   └── v0002/
    ├── templates/
    ├── cases/
    └── runs/
```

- `manifest.json`：当前版本、输入角色、目标契约、执行命令、产物哈希和验证状态。
- `versions/`：只增不改的实现版本。每个已发布版本保存当时的 `version-manifest.json`；发布后不得原地修改旧版本。
- `templates/`：用户同意保存的结果模板副本；不需要保存时只在 manifest 中记录外部引用和结构指纹。
- `cases/`：历史正确案例、回放请求或其引用。原始文件是否复制进来由用户决定。
- `runs/`：每次运行的请求、回执和异常摘要。结果文件可以放在用户指定的输出目录。

仓库受版本控制时，复制原始业务文件前先检查目标路径是否被忽略。不要默认提交含个人信息、商业数据或凭据的案例和结果模板。

## Manifest

`manifest.json` 必须符合 [manifest.schema.json](manifest.schema.json)。以下语义约束由 Agent 额外检查：

- `workflowId` 在当前规则库中唯一，目录名与其一致；
- `inputSlots` 中的 `slotId` 以及 `parameters` 中的 `name` 各自唯一；
- `version` 对应当前入口所在的 `versions/vNNNN/`；
- 根目录 manifest 的版本、入口、结构契约和产物哈希与当前版本的 `version-manifest.json` 一致；`status`、`updatedAt` 和 `changeSummary` 等工作流状态可以随后变化；版本快照本身不列入产物哈希，避免循环校验；
- `TRIAL` 或 `VALIDATED` 状态必须至少有一个 `PASS` 案例；
- `VALIDATED` 必须包含未参与初始规则发现的独立 `PASS` 案例；
- `SAVED_TEMPLATE` 必须提供模板相对路径和结构指纹；
- `USER_PROVIDED_TEMPLATE` 必须提供结构指纹；
- `implementation.command` 是参数数组，必须包含一次 `{request}`；
- 任务模板自己拥有的入口和产物路径都相对于任务模板目录，不能逃逸到其父目录；运行时可使用 PATH 中的命令或 manifest 明确记录的绝对路径；
- `implementation.artifacts` 覆盖执行所需的脚本、DSL、运行器和锁定依赖文件；
- 每个产物的 SHA-256 与实际文件一致；
- 结构指纹的 `basis` 指向版本目录中可阅读的结构描述，不能只保存不可解释的摘要哈希。

## 运行请求

每次执行生成一个 UTF-8 JSON 文件：

```json
{
  "schemaVersion": "0.1",
  "workflowId": "monthly-example",
  "workflowVersion": 1,
  "inputs": {
    "primary-source": ["/absolute/path/source.xlsx"]
  },
  "targetTemplatePath": "/absolute/path/template.xlsx",
  "outputPath": "/absolute/path/result.xlsx",
  "parameters": {}
}
```

约束：

- `inputs` 的键必须来自 manifest 的 `slotId`；值始终使用数组，以兼容单文件和多文件角色；
- 路径在请求文件中使用绝对路径，不依赖当前 shell 目录；
- `targetTemplatePath` 仅在目标模式需要模板时提供；
- `outputPath` 不能等于任何输入或模板路径，且默认不得指向已存在文件；
- `parameters` 只包含 manifest 已声明、当前运行允许变化的参数；
- 运行请求是本次执行状态，不得反向修改长期规则。

manifest 中的命令示例：

```json
[
  "python3",
  "versions/v0001/transform.py",
  "--request",
  "{request}"
]
```

Agent 将 `{request}` 替换为本次运行请求的绝对路径，并以参数数组直接启动进程。不要把数组拼成 shell 字符串执行。

## 结构指纹

结构指纹应对业务数据变化稳定、对可能改变含义的结构变化敏感。先生成规范化结构描述，再计算其 SHA-256。描述按任务需要包含：

- 文件类型与工作表顺序或选择规则；
- 表头文字、层级、位置和重复情况；
- 数据区域方向与关键字段类型；
- 主键、复合键和跨表关联字段；
- 目标写入区域、保护区域、公式骨架和合并区域；
- 会影响读取或写入的隐藏行列、命名区域或工作簿特性；
- 明确允许变化的部分。

不要把完整文件哈希当成唯一结构指纹。完整文件哈希可以作为案例和运行回执的证据另行保存。

## 案例保存方式

每个案例在 manifest 中标记：

- `REPLAYABLE`：历史输入和正确结果仍可读取，可以参与以后回归；
- `REFERENCE_ONLY`：只保留指纹或外部记录，不能参与自动回归。

只有 `REPLAYABLE` 且最近结果为 `PASS` 的案例可以作为版本晋级证据。用户不希望保存原始数据时，尊重该选择，并说明这会限制未来自动回归和稳定等级。

## 状态

- `DRAFT`：尚无通过的历史回放；
- `TRIAL`：至少一个历史正确案例通过，但缺少独立验证；
- `VALIDATED`：独立案例通过且没有阻断项；
- `NEEDS_REVIEW`：结构、实现或规则变化尚未完成验证；
- `RETIRED`：不再用于新运行，但保留审计与回滚信息。

## 运行回执

每次运行至少记录：

- 任务模板 ID、版本和实现产物哈希；
- 输入、结果模板和输出文件的哈希；
- 输入结构指纹；
- 开始和完成时间；
- 执行退出状态；
- 阻断检查、警告和异常计数；
- 输出文件位置；
- 一次性人工修改及其确认。

默认只记录指纹、计数和必要的异常摘要，不复制原始单元格内容。

## 管理与回滚

- 列出任务模板时扫描根目录 manifest，展示名称、当前版本、状态、最近验证时间和所需输入，不读取原始案例内容。
- 导出任务模板时默认只包含 manifest、版本产物和非敏感结构契约；原始案例、运行结果和带业务数据的结果模板需要用户明确选择。
- 归档时将状态改为 `RETIRED`，不删除历史版本和回执。
- 回滚时不要把版本号直接改回旧值。以选定旧版本的产物创建一个新的递增版本，重新验证后再切换根目录 manifest，从而保留完整变更顺序。
