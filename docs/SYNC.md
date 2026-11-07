# 多人同步设计（P4.1）

> 状态：**已确认并实现（2026-11-07）**。P4.2、P4.3、P4.4 均已完成；服务端与客户端在本机双来源（`127.0.0.1` / `localhost`）实测通过。确认结果见第 13 节，落地差异见第 14 节。
> 目标读者：项目所有者。读完后需要决定的点集中在最后一节「需要你确认」。

## 1. 目标与边界

**要解决的事**：家里人各自的手机都能记录，换手机不丢数据，两台设备看到同一份照护记录。

**不做的事**：

- 不传原片。照片和视频体积大、传输成本高，且原本就建议留在手机相册。
- 不做账号体系、邀请、权限分级。一个家庭一把密钥。
- 不做实时协同。没有 WebSocket、没有在线状态，也不需要「正在输入」。
- 不做公开分享链接。

**为什么只同步 JSON**：结构化记录（照护、疫苗、里程碑、宝宝资料、回顾）才是「换设备会丢」的部分；原片仍在各自的相册与本机 IndexedDB 里。媒体只同步元信息，另一台设备上显示「原片在另一台设备」。

## 2. 同步单元

| 单元 | 是否同步 | 说明 |
|---|---|---|
| `profiles`（宝宝档案） | 是 | 整组，整体覆盖（含各自的 `vaccinePlan` 与 `milestones`；P5 起） |
| `entries`（成长与照护记录） | 是 | 按条同步，含 `care` 与 `babyId` |
| `vaccinations`（接种记录） | 是 | 按条同步 |
| `vaccinePlan`（特殊程序与二选一） | 是 | 随宝宝档案整体同步（P5 起不再是顶层单条） |
| `milestones`（里程碑勾选） | 是 | 随宝宝档案整体同步（P5 起不再是按键合并） |
| `activeProfileId`（当前看的宝宝） | **否** | 设备偏好，各看各的 |
| `recaps`（图文回顾） | 是 | 按条同步，只同步条目引用 |
| `media`（素材元信息） | 部分 | 只同步 id / 名称 / 类型 / 大小 / 拍摄时间 / 时长，不含字节与预览 URL |
| 原片与缩略图 | **否** | 对方记录显示「原片在另一台设备」 |
| AI 配置与密钥 | **否** | 只存本机 localStorage，永不进工作区 |
| 主题、引导、备份时间等偏好 | **否** | 属于设备偏好 |

## 3. 数据模型改动

> **实现说明（P4.2）**：落地时墓碑没有放在记录上，而是单独存进 `workspace.tombstones`（`{ kind, id, deletedAt, deviceId }`）。原因是界面里有 60 多处直接读 `entries` 等列表，已删除的记录如果还留在列表里，每一处都得过滤，漏一处就会把删掉的记录显示出来。墓碑单独存放，现有读取代码一行都不用改；推送时把墓碑转成 `deleted=1` 的条目即可，服务端表结构不变。里程碑的取消也用 `kind: "milestone"` 的墓碑表示，不再用空字符串。下面 3.1 的 `deletedAt` 仍是推送和拉取时的线上格式。

### 3.1 每条记录新增字段

```ts
interface SyncMeta {
  /** 最后修改时间，ISO 字符串（UTC）。旧数据迁移时取 capturedAt 或 createdAt。 */
  updatedAt: string;
  /** 删除墓碑：非空表示已删除，值为删除时间。 */
  deletedAt?: string;
  /** 最后一次写入的设备标识，用于排查冲突，不参与胜负判断。 */
  deviceId?: string;
}
```

- `GrowthEntry`、`VaccinationRecord`、`Recap`、`MediaAsset` 都加上这三个字段。
- `baby`、`vaccinePlan` 是单条对象，各自用一个 `updatedAt` 即可，放在 workspace 顶层：`babyUpdatedAt`、`vaccinePlanUpdatedAt`。
- `milestones` 是 `key → 日期`，同步时按 key 求并集，删除用 `key → ""` 的空字符串表示（与当前「取消勾选即删键」不冲突，服务端把空字符串当墓碑）。

### 3.2 为什么用墓碑而不是直接删

两台设备离线时，A 删除、B 修改同一条记录，如果直接物理删除，B 推上来会把它「复活」，用户会以为删除失效。墓碑保留「谁在什么时候删的」，同步层才能判断。

墓碑保留 90 天后由服务端清理（`deletedAt` 早于 90 天且没有新写入）。

### 3.3 时钟不可信

后写者胜依赖时间戳，但手机时间可能被手动改过。处理方式：

- 客户端上报的 `updatedAt` 只作为**候选**，服务端在写入时同时记录 `serverUpdatedAt`（服务端时间）。
- 冲突判断用 `serverUpdatedAt`，客户端时间仅用于同一次推送内的排序。
- 因此 `P4.3` 的接口返回里要带 `serverUpdatedAt`，本地保存它用于下次增量拉取。

## 4. 冲突处理

**规则：同一条记录以 `serverUpdatedAt` 较晚者为准（后写者胜），整体覆盖，不做字段级合并。**

理由：

1. 记录是「家长写下的一件事」，字段之间有关联（改奶量常常同时改时间），字段级合并会产出谁都没写过的组合。
2. 家庭自用，两个人同时改同一条记录的概率很低；真发生时，覆盖比合并更好解释。
3. 字段级合并需要给每个字段存时间戳，数据量与实现复杂度都翻倍，收益不明显。

**例外**：`milestones` 按键合并，因为每次勾选只影响一个 key，天然可合并。

**冲突提示**：被覆盖的一方在下次拉取时，如果本地记录和服务端记录都改过，界面提示一次「这条记录在另一台设备上更新过，已采用较新的版本」，只提示一次，不弹窗阻断。

## 5. 接口

单文件 Node 服务（Node 22，仅用标准库 + `better-sqlite3` 或 `node:sqlite`），Nginx 反代到 `https://<域名>/sync/`。

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/sync/health` | 返回 `{ ok: true, version }`，部署后自检用 |
| `POST` | `/sync/pull` | 入参 `{ since?: string }`，返回 `{ now, entries, vaccinations, recaps, media, baby?, vaccinePlan?, milestones }`，只含 `serverUpdatedAt > since` 的条目（含墓碑） |
| `POST` | `/sync/push` | 入参 `{ deviceId, records[], singletons{} }`，返回 `{ now, applied, rejected[] }`（落地格式见第 14 节；P5 起 `singletons` 只有 `profiles`） |
| `POST` | `/sync/reset` | 家庭密钥 + 确认口令 `{"confirm":"清空同步数据"}`，清空服务端数据（回滚用） |

约定：

- 所有请求 `Content-Type: application/json`，请求体上限 1 MB（纯 JSON，不含原片）。
- 鉴权头 `Authorization: Bearer <家庭密钥>`，密钥 32 字节随机十六进制，部署时生成。
- 只允许 HTTPS；HTTP 请求直接 400，避免密钥明文上网。
- 服务端不做业务校验（不判断体温是否合理），只做结构校验与版本判断；业务规则仍在前端领域层，避免两份规则漂移。

## 6. 存储

SQLite 单文件 `/var/lib/babytime/sync.db`：

```sql
create table records (
  kind text not null,        -- entry | vaccination | recap | media
  id text not null,
  payload text not null,     -- 原始 JSON
  updated_ms integer not null,
  deleted integer not null default 0,
  device text,
  primary key (kind, id)
);
create table singletons (
  key text primary key,      -- baby | vaccinePlan
  payload text not null,
  updated_ms integer not null,
  device text
);
create table milestones (
  key text primary key,
  date text not null,        -- 空字符串表示取消
  updated_ms integer not null
);
```

单家庭规模估算：每天 20 条记录、一年 7000 条，JSON 约 3 MB，SQLite 完全够用，不需要分页以外的优化。

## 7. 客户端流程

```
启动 → 读本机 IndexedDB → 渲染（不等网络）
     → 若同步开启且在线：pull(since=lastSyncAt) → 合并到本机 → 再渲染
     → 写入时：先写本机（立刻可见）→ 标记 dirty → 空闲时 push
```

- **本地优先**：任何写入先落 IndexedDB，同步失败不影响使用，失败项留在 `babytime.syncQueue`（localStorage，最多 200 条），下次联网重试。
- **增量拉取**：`lastSyncAt` 存 localStorage，取服务端返回的 `now` 作为下次的 `since`。
- **推送粒度**：`push` 只发 `updatedAt > lastPushedAt` 的条目；单次最多 200 条，超过分批。
- **开关**：家庭页「多设备同步」开关，默认关闭；打开时要求输入家庭密钥并先做一次 `pull`，让家长看到将要合并多少条。

## 8. 部署改动

`scripts/deploy.sh` 增加 `sync` 子步骤（不进默认流程，需要 `--with-sync`）：

1. 服务器创建 `babytime-sync` 系统用户与 `/var/lib/babytime`。
2. 上传 `server/sync.mjs`（单文件）与 `server/package.json`。
3. `systemd` 单元 `babytime-sync.service`，`Restart=always`，只监听 `127.0.0.1:8787`。
4. Nginx 增加 `location /sync/ { proxy_pass http://127.0.0.1:8787/; }`，只开 443。
5. 首次部署生成家庭密钥，打印一次到终端（不写日志），并提示家长保存到密码管理器。

若坚持不用 SQLite，可退化为每家庭一个 JSON 文件（原子写 + 进程内锁）。单家庭写入频率很低，这也够；选择 SQLite 是因为墓碑清理和 `since` 查询更简单。

## 9. 迁移（P4.2，可先单独上线）

已实现（`src/domain/sync-meta.ts`）：

- `migrateSyncMeta`：读入本机数据或导入备份时，给 `entries` / `vaccinations` / `recaps` / `media` 中缺 `updatedAt` 的条目补上 `capturedAt || createdAt || 迁移时间`（统一转成 UTC ISO），`deviceId` 补当前设备，并初始化空的 `tombstones`。幂等。宝宝资料与疫苗计划**不补**时间：缺失表示「迁移后从未改过」，以免新设备的空资料在首次同步时盖掉真实资料。
- `stampChanges`：`useWorkspace().update()` 与「连原片一起删除」两条写入路径在落库前对比前后工作区，新增或内容变化的条目盖 `updatedAt` / `deviceId`，消失的条目写墓碑，重新出现的条目撤销墓碑；资料、疫苗计划变化分别记 `babyUpdatedAt`、`vaccinePlanUpdatedAt`。示例数据（`demo: true`）删除不写墓碑。
- **`schemaVersion` 保持 1**：旧版前端的 `isWorkspace` 要求严格等于 1，升到 2 会让第 10 节的「回滚后旧版本仍能读取」失效。新字段全部可选，旧版前端读到时直接忽略。
- 旧备份照常导入，导入后按同样规则补字段；新备份会带上墓碑与同步字段，校验见 `workspace-schema.ts`。
- 这一版**不联网也能上线**，是纯本地数据结构升级。
- 留给 P4.3 的事：墓碑推送成功后再按 90 天清理（现在只增不减）；里程碑没有逐键修改时间，新增勾选按推送快照判断；示例数据也会被盖章，推送时要排除 `demo`。

## 10. 回滚

- **关开关**：家庭页关闭同步 → 停止 pull/push，本机数据不动，服务端数据保留。这是默认回滚路径。
- **清服务端**：`POST /sync/reset` 或登录服务器删 `sync.db`；下次打开同步会要求重新初始化。
- **卸载服务**：`systemctl disable --now babytime-sync`，删 Nginx 配置，重新 `npm run deploy` 覆盖；前端关掉同步开关后与现在完全一致。
- **数据降级**：`P4.2` 的墓碑字段对旧版本前端是「多余字段」，旧版本仍能读取（结构校验是宽松的）；如需彻底回退到 v1 结构，用「导出备份 → 清空 → 恢复」走一遍迁移前后的对照。

## 11. 测试计划

自动化（不依赖网络，服务端用内存实现）：

1. `push` 新记录 → `pull(since)` 能拿到，`serverUpdatedAt` 单调递增。
2. 两台设备改同一条 → 后推者胜，先推者收到一次冲突标记。
3. A 删除、B 修改 → 删除墓碑胜出，记录不复活。
4. `milestones` 两端各勾不同 key → 并集。
5. 旧备份（version 1）导入 → 补 `updatedAt` 后可正常同步。
6. `since` 之后没有变化 → 返回空数组，不重复下发。
7. 请求体超过 1 MB、缺鉴权头、非 HTTPS → 明确拒绝。

手动（P4.3 验收）：

- 两个浏览器 profile 同时登录，A 改、B 看，B 刷新后一致。
- A 删除、B 改同一条，结果符合第 4 节。
- 断网写入 10 条，恢复网络后自动补齐。
- 关掉同步后本机数据不受影响。

## 12. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 家庭密钥泄露 | 任何人可读写这家数据 | 只走 HTTPS；密钥可一键轮换（改服务端环境变量并重新部署，旧密钥立即失效）；不写日志 |
| 手机时间被改 | 后写者胜判断失真 | 用服务端 `serverUpdatedAt` 判定，客户端时间只做排序 |
| 墓碑堆积 | 数据库变大 | 90 天清理任务，随 `pull` 顺带执行 |
| 无原片导致误解 | 对方以为记录没图 | 界面固定文案「原片在另一台设备」，与现有缺失原片提示一致 |
| 同步逻辑侵入领域层 | 业务规则被两份实现 | 服务端只做结构校验，规则全部留在前端 `domain/` |

## 13. 需要你确认

1. **是否继续做 P4.2–P4.4？** 只做 P4.2（本地补字段 + 墓碑）也能先上线，风险最低；P4.3 才动服务器。
2. **后端选型**：SQLite（推荐，查询与清理简单）还是单 JSON 文件（零依赖，但并发写要自己加锁）？
3. **密钥分发**：部署时打印一次家庭密钥、由你手动存进密码管理器，可以接受吗？还是要做成「扫码配对」这类更省事但更复杂的方式？
4. **冲突策略**：接受「后写者胜、整条覆盖」吗？如果希望「同一条记录两边都保留」，改动会明显变大（需要生成冲突副本，UI 也要多一步合并）。
5. **原片怎么办**：只同步元信息、缺失时提示「原片在另一台设备」，符合你的预期吗？还是希望后续做「按需从对方设备拉原片」（需要设备间直连或对象存储，工作量另算）。
6. **域名与备案**：同步服务打算放在现有 ECS 的哪个域名下？备案完成前只有 IP 证书，密钥写在 `http://` 上是不可接受的，所以 P4.3 前提是 HTTPS 可用。

确认以上几点后，我会按 `P4.2 → P4.3 → P4.4` 推进；在此之前不会改数据结构、不会动部署脚本。

**确认结果（2026-11-07）**：

1. 先只做 P4.2，P4.3–P4.4 暂缓。
2. 后端用 SQLite，选 Node 22 自带的 `node:sqlite`（不装依赖，要求服务器 Node ≥ 22.5）。
3. 部署时打印一次家庭密钥、手动保存：接受。
4. 后写者胜、整条覆盖：接受。
5. 只同步元信息，缺原片时提示「原片在另一台设备」：接受。
6. 地址：挂在现有 IP 证书的 `https://<服务器IP>/sync/` 下。

## 14. 落地实现与设计稿的差异（P4.3）

- **推送格式**：没有 `changes` 包一层，直接是 `{ deviceId, records[], singletons{}, milestones{} }`；服务端不返回 `conflicts[]`，而是返回 `rejected[]`（本机要推的新版本撞上已删除的墓碑，客户端据此删掉本地副本），冲突提示由客户端在合并时按 `kept` / `removed` 计数生成。
- **拉取跳过本设备**：`pull` 带上 `deviceId`，增量拉取时不返回自己写过的行，避免刚推上去的内容又被拉回来盖章。
- **待推清单**：`workspace.syncDirty` 记本机改过、还没推送的键；推送成功后只清除没再改过的键（按内容指纹对比），墓碑同时清理。不开同步时清单与墓碑只增不减，体积与记录数同量级。
- **墓碑 TTL**：服务端在每次 `pull` 时删除 90 天前的墓碑（`TOMBSTONE_TTL_MS`），不再单独跑清理任务。
- **密钥存放**：服务器上在 `/etc/babytime-sync.env`（仅 root 可读），首次安装时打印一次到终端；客户端只存 localStorage `babytime.sync`，不进 workspace 与备份 JSON。
- **清空本机数据**会同时清除本机的家庭密钥（否则下次同步会把服务器上的记录全部拉回来）；服务器与家人设备不受影响。
- **本机开发**：`vite.config.ts` 把 `/sync/` 代理到 `127.0.0.1:8787`，`BABYTIME_SYNC_ALLOW_HTTP=1 node server/sync.ts` 起服务端；`syncUnavailableReason()` 用 `isSecureContext` 判断，`127.0.0.1` / `localhost` 放行，部署后的 http 地址仍被拦下。

## 15. 多宝宝（P5）对同步的影响

- 宝宝档案从顶层 `baby` 改成 `profiles[]`，作为单个 singleton 整体覆盖；档案里带着各自的 `vaccinePlan` 与 `milestones`，所以两个宝宝的疫苗计划和勾选互不干扰。
- 记录 payload 带 `babyId`；墓碑逻辑不变。删除宝宝 = 把它的记录全部移出，`stampChanges` 一并写墓碑，另一台设备同步后同样看不到。
- 旧结构迁移出的宝宝用固定 id `default`：两台设备各自升级后记录归到同一个档案，不会因为随机 id 对不上而在对方设备上「消失」。新加的宝宝用随机 id。
- `activeProfileId` 只存本机，不参与同步。
