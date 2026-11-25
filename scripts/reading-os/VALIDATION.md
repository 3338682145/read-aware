# Reading OS 知识编译器原型验收

在独立 Git Worktree 的 `codex/reading-os-knowledge` 分支实现。基于 ReadAware v0.6.12，基准提交 `a9f2c6fd1abe35478b93d9e5405086da4b42f5cc`。基线冻结提交 `e4bb311`，模型评测使用 `d383963` 的代码。

## 评测基线门

- 保留 120 条评测记录、36 个知识锚、13 份官方来源清单及原消融结果。用原始缓存重跑，结果和冻结 JSON 相等。
- 另建 scikit-learn `Decision Threshold Tuning` 留出集，4 个主张在实现和调试前写入、哈希入库。生成进程只读原文范围与读者问题。评分器单独读取答案和人工语义复核。此集为任务内编写，尚无独立复审人员或更大盲测规模。
- Bun 1.4.4 与 Pi AI/Core 1.5.0 按原工作区锁定。模型、权重与运行器校验和见 `eval/model*.json`。起始 Qwen2.5 1.5B 配置仅用于开发集，观察到格式失败、误读 1.4 参数和复述问题。开发集失分后锁定 Qwen3 4B 配置继续，留出数据、评分标准和提示输入划分未变。

## 知识编译器门

原型运行 ReadAware 的 Pi provider、结构化单次推理和调用回执。读取官方 scikit-learn 源码文档，校验整文件 SHA-256，将返回的出处 ID 绑定到固定行范围，经 SQLite 事务写入。相同文档目标的规范值合并，版本观察和各自证据分别保留。真实数据库演示得到 3 条规范值和 4 条版本观察，重放 1.4.2 没有发起模型调用。

| 开发样本 | 按冻结金标和原文复核 | 摘要 |
|---|---:|---|
| scikit-learn 1.3.2 | 2/2 | 组标签用 `groups`，评分只允许一个指标。 |
| scikit-learn 1.4.2 | 2/2 | 启用元数据路由时组标签嵌在 `params`，评分仍只允许一个指标。 |

留出集单次真实推理 **3/4**，精确率与召回率均为 75%，达到冻结的小样本门槛。三个通过项为概率阈值严格大于 0.5、分数阈值严格大于 0、默认五折分层。失分项为 `cv="prefit"` 应使用独立验证数据，模型结构化答成 `no`，解释又正确地要求独立数据，内部矛盾。该结果已计为失败。锚点校验能保证出处真实，语义正确性仍通过评分与人工核验。

Qwen3 4B 两次开发调用耗时 29.5 秒和 23.3 秒，留出调用耗时 64.7 秒，重放约 2 毫秒。以上为本机 CPU 实测，未估算生产负载。

[1.3.2 官方源码][source132] · [1.4.2 官方源码][source142] · [独立留出原文][blind]

本轮原型门通过。开发集 4/4、留出集 3/4，独立数据库中的错误候选保留为评测记录，供回放核查。

## 工程验证

| 检查 | 已验证结果 |
|---|---|
| TDD 原型行为 | 8/8。覆盖原文件哈希、证据边界、数据库重开、规范值去重、版本冲突、非法与重复输出、并发幂等和拒写其它数据库。 |
| 评分器 | 2/2。引文绑定与模型语义正确性各自计入评分。 |
| ReadAware Agent 回归 | 851/851。 |
| 脚本 TypeScript、Biome、Bash 语法 | 已通过目标范围检查。 |
| ReadAware workspace 测试 | 19/20 tasks。Web 有一个涉及 debounce 的插件列表用例在全套运行失败，同一用例单独跑通过。另一个 RSS 用例初次受沙箱无 /tmp 影响，设置工作区临时目录后通过。 |
| 真模型 | 在本地 CPU 上调用 llama.cpp b7400 和冻结 Qwen3-4B 量化权重，ReadAware/Pi 回执记录真实结束原因。 |

原型使用专用 SQLite 数据库及文档行范围。本轮验证覆盖 CLI，Tauri 插件私有存储、阅读界面、EPUB CFI、PDF、复习排程与 Skill 发布继续留在后续阶段。源码中的知识抽取针对固定读者目标，近义实体合并和全书自由抽取需扩大评测。小样本结果只代表这批输入。

[source132]: https://github.com/scikit-learn/scikit-learn/blob/093e0cf14aff026cca6097e8c42f83b735d26358/sklearn/model_selection/_validation.py#L459-L473
[source142]: https://github.com/scikit-learn/scikit-learn/blob/8721245511de2f225ff5f9aa5f5fadce663cd4a3/sklearn/model_selection/_validation.py#L599-L620
[blind]: https://github.com/scikit-learn/scikit-learn/blob/f159b78dc59f250cdde8fe391a21f0bc871960ad/doc/modules/classification_threshold.rst
