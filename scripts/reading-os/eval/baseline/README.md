# Reading OS 阅读评测种子 v0.1

36 条人工金标知识、84 个配套用例，共 120 条。底稿为 CPython 3.9/3.10/3.13 官方文档、Git 2.52.0 手册和固定提交的 Rust Book。每个原文锚可按提交、文件与行号定位，下载的字节须和 SHA-256 一致。终端引导、权限异常和冲突是基于真实资料设计的对抗夹具。

| 文件 | 内容 |
|---|---|
| sources.json | 13 份原文的来源、Git commit、版本、路径与 SHA-256 |
| atoms.json | 36 条人工知识标注及定位短语和行号 |
| cases.json | 去重 30、引用 22、更新 12、抽取负例 6、学习题 8、Skill 用例 6 |
| check.py / results.json | 核对来源与规则消融，附本次运行结果 |
| fsrs-smoke.mjs / fsrs-results.json | ts-fsrs 真包的复习调度冒烟及结果 |

## 运行

解压后使用 Python 3.10 或更高版本，在评测包目录执行。

```sh
python3 check.py --fetch
python3 check.py --emit-inputs extraction-inputs.jsonl
```

首次从固定的公开 GitHub 地址下载源文件到 `source-cache/`。如已缓存文件，第二步可断网执行。默认不会把全文包含在评测包里。下载文件遵从对应项目的许可。英文定位短语只是导航线索，评审要读完整上下文。CPython [许可](https://docs.python.org/3.13/license.html)、Git [许可](https://github.com/git/git/blob/v2.52.0/COPYING)、Rust Book [许可](https://github.com/rust-lang/book#license)。

如果已有按 `sources.json` 校验过的文本缓存，可传 `--cache /path/to/cache` 复跑。 `--emit-inputs` 生成 36 个不含金标结论与准确锚点的有行号输入窗口，用于离线模型试验。窗口围绕证据预先选定，因此需要另做全文召回测试。配套负例描述生成错误和预期处置，不是 6 个空白原文窗口。

以 Node 24+ 在解压目录安装固定版并运行 FSRS smoke。

```sh
npm install --ignore-scripts --no-audit --no-fund ts-fsrs@6.0.1
node fsrs-smoke.mjs
```

## 结果范围

- 13 份原文哈希和 36 个金标位置已校验。Python/Git 为开发切片，Rust 为跨书系 challenge 样本。样本逐条可查，尚未进行双人独立标注。用于调阈和构建模型后，需要增加按书系分组的盲测集。
- 规则消融使用手工给定的实体、槽位、极性及授权证据范围。引用清单用行级锚，生产 EPUB CFI 和 PDF 页/区域要另加实机回放。更新实验比较规则输出，没有运行产品存储。
- 学习题是任务与评分点，计划用于盲评。数据集没有真人答题数据，也没有模型抽取成功率。请先固定生成模型、引用格式、预算和人工 rubric 再比较候选。
