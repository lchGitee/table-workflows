# 部门工时汇总：新批次运行

用户请求：用之前保存的“部门工时汇总”处理 inbox/next.xlsx 新源表，生成新结果。

执行约束：根据根 Skill 的运行模式与 references/run-workflow.md，选择已保存的 department-hours v0001（TRIAL），读取已确认业务政策并运行固定入口；不重新发现规则，不修改实现、Manifest 或长期政策。新源表绑定 source，结果模板使用已保存的 templates/result.xlsx，新结果和回执保存 runs/next-batch/。

确认问题：无。现有模板已经完整声明输入、结果模板、业务规则和执行方式。

## 最终说明

已按固定 v0001 执行，退出状态 0，回执 PASS。6 条输入中统计 5 条已确认记录，排除 1 条撤回记录，输出 2 个部门，净工时合计 2.75。D01 为 2 条、-1.5；D02 为 3 条、4.25。负数与零记录按已有政策处理，未修改业务规则。

实现哈希与依赖锁匹配；实际新源表和保存的结果模板指纹均匹配。输出重新打开、目标结构、标题保护区、逐格导出检查及视觉检查通过，公式错误 0、异常 0、未匹配 0、重复记录 0。仍为 TRIAL，建议人工复核本批；未提供独立人工正确结果，未升级状态。

输出：department-hours/runs/next-batch/result.xlsx

原始运行回执：department-hours/runs/next-batch/request.receipt.json

本次运行请求：department-hours/runs/next-batch/request.json

无阻塞。未修改固定实现、Manifest 或长期政策，未安装依赖、未联网，运行完成后停止。
