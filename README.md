# siyuan-notes-for-dsh

让 DeepSeek Harness 直接读写本地思源笔记（SiYuan）的薄插件：6 个工具，直连思源内核 REST API，不经过 MCP。

选定一个目标笔记本之后，**整本笔记本都可写**：任意子路径新建文档、任意文档追加、任意块改写。插件不再限定某个子目录。

## 安装

1. 解压，得到 `siyuan-notes/` 目录（里面有 `package.json`）。
2. 在 DSH 里让 agent 执行 `plugin_manager`：`action=install_bundle`、`target=<解压后的 siyuan-notes 绝对路径>`。
3. 重启 DSH，会话里就应该出现 `siyuan_notebooks` 等 6 个工具，设置里多出「思源笔记」一页。

## 设置页（只配一件事：写哪个笔记本）

打开 DSH「设置 → 思源笔记」，页面上只有一个下拉框「写入目标笔记本」：

- 选项来自思源里**已打开**的笔记本，带文档数量；选好点「保存」。
- 留空 / 「清除选择」= 不固定目标：只有一本打开的笔记本时自动用它，否则每次工具调用都要自己传 `notebook`。
- 「重新检测」重新读思源状态（新打开笔记本、思源刚启动时点一下）。

页面会主动提示两种情况：

- **思源没启动**：顶部出现黄色横幅「思源笔记没有运行」，写出找到的安装路径（例如 `D:/software/siyuan/SiYuan.exe`）和内核报错，并给出「重新检测」按钮——启动思源后点一下就好。插件只检查路径是否存在，**不会替你启动思源进程**。
- **还没绑定笔记本**：出现「推荐绑定」卡片，按「最近有写入 > 名字像收集箱/日常/笔记库 > 文档数量」排序给出建议和理由，可一键「绑定这本」；下面还会列出其他候选，各自带「绑定」按钮。不想用推荐就在下拉框里自己选。

工具调用在没绑定时也会给出同样的建议（例如 `没有指定 notebook…建议绑定「收集箱」…`），而不是一句干巴巴的报错。

保存值落在本机 `<DSH_HOME>/siyuan-notes/settings.json`（默认 `C:\Users\<你>\.dsh\siyuan-notes\settings.json`），只影响这台设备；换机器重新选一遍即可。页面底部还会显示设置文件位置、内核地址，以及内核/笔记本连接状态——排查连不上时先看这里。

连接细节（内核地址、token 文件）不用在页面上填：优先用下面「部署默认值」里的配置，取不到时插件会自动找——`SIYUAN_TOKEN` 环境变量 → `SIYUAN_CONF` 指向的 `conf/conf.json` → `~/SiYuan/*/conf/conf.json`（以及 `~/Documents/SiYuan/*/conf/conf.json`）。

## 部署默认值（`cordis.patch.yml`，可选）

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | 思源内核地址，默认 `http://127.0.0.1:6806` |
| `tokenFile` | 工作区的 `conf/conf.json`；token 每次调用现读，不写日志、不进输出 |
| `notebook` | 默认笔记本的 id 或名称；留空则完全由设置页决定 |
| `defaultDocId` | 默认文档 id：`siyuan_doc_append` / `siyuan_doc_read` 省略 id 时兜底（可选） |
| `timeoutMs` | 单次调用超时，默认 20000 |

旧版的 `defaultNotebook` 仍被识别为 `notebook`；`defaultParentPath` 已废弃（写入不再限定目录）。

## 工具

- `siyuan_notebooks`：列笔记本 / 新建笔记本
- `siyuan_doc_create`：Markdown 新建文档（`parentPath` 可写任意层路径，省略写笔记本根目录；自动去掉与标题重复的首行 H1）
- `siyuan_doc_append`：向任意文档文末追加
- `siyuan_block_update`：按块 id 改写整本笔记本里的任意块
- `siyuan_search`：全文检索，或 `mode:"sql"` 只读查询
- `siyuan_doc_read`：按 id 读 Markdown

删除类接口（`removeDocByID`、`removeNotebook`、`deleteBlock`）**没有封装**，避免模型误删笔记。

## 开发

- `index.js`：Host 半区，注册 6 个工具 + 两条设置路由（`/api/siyuan-notes/state`、`/api/siyuan-notes/settings`，仅回环地址可访问）。
- `client.js`：Web 半区，设置页面板（`window.__ModuleLoader__` 格式，无构建、无 JSX）。
- 本地是 `link:` 依赖，改完源码必须 `remove_bundle` → `install_bundle` 才会生效，改文件不会热重载；之后刷新浏览器页面才能看到设置页的变化。
- `node test/routes.test.mjs`（临时 `DSH_HOME`，不碰真实设置文件）与 `node test/client.test.mjs`（桩掉 React，渲染中英文两种界面）都不需要安装依赖；`npm test` 一次跑完两组。

---

Apache-2.0 © jizi-dragon · 仓库：https://github.com/jizi-dragon/siyuan-notes-for-dsh
