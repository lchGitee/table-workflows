# 服务计划回填：新批次运行

用户请求：用之前保存的“服务计划回填”处理 inbox/next.xlsx 新源表，生成新结果。

选择已有 service-plan / v0001 / TRIAL。输入角色为当批需求，沿用已保存的结果模板。未继承其他任务的业务规则。

已阅读 SKILL.md、references/run-workflow.md、references/workflow-bundle.md，以及本任务 manifest、README 和固定实现。根 Manifest 与版本快照的实现/输入/目标一致，全部实现产物与依赖锁校验通过。环境无标准 JSON Schema 校验器，已按契约检查必填字段及语义，未执行标准 JSON Schema 机器校验。

遵循运行模式：只新增请求与运行产物，不修改实现、Manifest 或长期规则。按 Manifest 参数数组调用固定版本；输入和模板结构由原执行入口重新提取。

运行结果：原入口退出 0，源表和保存模板的实际观察结构指纹均匹配，异常 0、未匹配 0。2 条需求映射到固定 3 行，1 个缺少需求项目按已有政策填 0。数量为 5、0、7，合计 12，金额合计 85。

运行后重新读取结果：只修改 C4:C6 的普通值；相关公式缓存随重算更新，公式文本未变。普通保护值及单元格样式未变，目标结构、合并与元数据相同。结果预览可读且无明显公式错误。未取得独立人工正确结果，本次不晋级状态，仍为 v0001 / TRIAL，建议人工复核。

结果：service-plan/runs/new-batch/result.xlsx。
原执行器回执：service-plan/runs/new-batch/request.json.receipt.json。
本次无业务确认问题、无实现修改、无安装和网络访问。
