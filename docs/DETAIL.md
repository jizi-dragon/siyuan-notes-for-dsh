# SiYuan Notes

给 DeepSeek Harness 加一组「写思源笔记」的工具。它直接调本地思源内核的 REST API（默认 `http://127.0.0.1:6806`），不经过 MCP，所以常驻上下文只有这六个工具的描述（约 700 token），而不是思源 MCP 整套 31 个工具的两万 token。

选定目标笔记本后，**整本笔记本都可写**：任意子路径新建文档、任意文档追加、任意块改写；插件不限定子目录。

## 工具

| 工具 | 用途 |
| --- | --- |
| `siyuan_notebooks` | 列出笔记本；必要时新建一个 |
| `siyuan_doc_create` | 用 Markdown 新建文档，可指定笔记本和任意父路径 |
| `siyuan_doc_append` | 在已有文档末尾追加 Markdown 块 |
| `siyuan_block_update` | 用 Markdown 覆盖某个块的内容 |
| `siyuan_search` | 全文检索，或执行只读 SQL |
| `siyuan_doc_read` | 按文档 id 读出 Markdown |

删除类接口（`removeDocByID`、`removeNotebook`、`deleteBlock`）**没有**封装，避免模型误删笔记。

## 配置

配置分三层，后者覆盖前者：

1. `cordis.patch.yml` 的 `config`：部署默认值。
2. `<DSH_HOME>/siyuan-notes/settings.json`：本机用户在设置页里保存的覆盖值（默认 `C:\Users\<你>\.dsh\siyuan-notes\settings.json`）。
3. 代码里的内置默认值。

设置页只做一件事：选目标笔记本（下拉，选项来自思源里已打开的笔记本，带文档数）。留空表示不固定目标——只开着一本时自动用它，否则工具调用需自带 `notebook`。换设备各选各的，配置保存在本机。保存后立即生效，无需重启插件；「清除选择」清空覆盖值。

设置页与工具调用都会主动引导：

- **思源没启动**：设置页顶部黄色横幅「思源笔记没有运行」，附上 `discoverSiYuanApp()` 找到的安装路径（候选：`D:/software/siyuan/SiYuan.exe`、`C:/Program Files/SiYuan/SiYuan.exe`、`C:/Program Files (x86)/SiYuan/SiYuan.exe`、`%LOCALAPPDATA%/Programs/SiYuan/SiYuan.exe`、环境变量 `SIYUAN_EXE`）与内核原始报错，并提供「重新检测」。插件**只做存在性检查，不会启动进程**。
- **还没绑定笔记本**：`recommendNotebook()` 排序给出建议 —— 最近有写入（`SELECT box, MAX(updated) … GROUP BY box`）优先，其次是名字像收集箱(+25)/日常(+12)/笔记库(+6)，最后按文档数（`min(20, log2(1+n)*3)`）。返回值 `recommendation {ok,id,name,reason,candidates[≤5]}` 既给设置页渲染「推荐绑定」卡片（一键绑定 + 其他候选），也用于 `resolveNotebook()` 在缺省目标时的报错文案。

字段说明：

- `notebook`：目标笔记本 id 或名称；设置页写入的就是它。旧字段名 `defaultNotebook` 仍被识别。
- `baseUrl`：思源内核地址，默认 `http://127.0.0.1:6806`。
- `tokenFile`：工作区的 `conf/conf.json`。token 在每次调用时读取，不写入对话、不写日志。留空/读不到时自动找：`SIYUAN_TOKEN` → `SIYUAN_CONF` → `~/SiYuan/*/conf/conf.json`（含 `~/Documents/SiYuan/*`）。
- `defaultDocId`：`siyuan_doc_append` / `siyuan_doc_read` 省略 id 时的兜底文档（可选）。
- `timeoutMs`：单次内核调用超时，默认 20000。

设置页读写的两条路由（`GET /api/siyuan-notes/state`、`POST /api/siyuan-notes/settings`）只接受回环地址的请求，非回环返回 403。`state` 还会返回内核连接状态、笔记本列表，以及当前解析出的目标笔记本。

## 注意

- 思源必须正在运行，且「设置 → 关于」里的 API 端口与 `baseUrl` 一致。
- 标题里的 `/`、`\` 会被替换成 `-`，因为思源用标题做文件名。
- `siyuan_doc_create` 会自动去掉与标题相同的第一行 H1 —— 思源里文档标题本身就是标题，不删会重复显示一次。
- `siyuan_search` 的 `mode: "sql"` 可以跑只读查询，例如 `SELECT id, content FROM blocks WHERE type = 'p' LIMIT 20`。
- 修改本插件源码后必须卸载再装一次（`plugin_manager action=remove_bundle` → `install_bundle`）才会生效；这是本地 `link:` 依赖，改文件不会热重载。
