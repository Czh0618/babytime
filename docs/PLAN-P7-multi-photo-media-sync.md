# P7 计划：一条记录多张照片 + 原片存 ECS（2026-11-08 已与用户确认）

执行顺序：先 P7.1（多图），再 P7.2（原片同步）。P7.2 依赖 P7.1 的数据结构。
每个子任务完成后在 `docs/TASKS.md` 勾选并写结果记录，延续原有风格（测试数 + 实测证据）。

## 现状（改动前须知）

- `GrowthEntry.mediaId?: string`、`Candidate.mediaId: string`（`src/types.ts:67,93`），共 15 个文件、54 处引用：
  `src/lib/workspace.ts`(15) `src/lib/storage.ts`(12) `src/App.vue`(4) `src/domain/seed.ts`(4) `src/views/InboxView.vue`(3)
  `src/domain/{media-refs,records,workspace-schema}.ts` `src/components/RecapPreview.vue` `src/views/RecapView.vue`(各 2)
  `src/components/EntryEditor.vue` `src/domain/recap-draft.ts` `src/lib/export.ts` `src/views/TimeView.vue`(各 1)。
  开工前先 `grep -rn mediaId src server tests` 重新核对。
- 原片与缩略图只存本机 IndexedDB（`src/lib/storage.ts`），同步服务 `server/sync.ts` 只存 JSON，`MAX_BODY` = 1 MB，
  Nginx `location /sync/` 也是 `client_max_body_size 1m`（`scripts/deploy-remote.sh:196`）。
- 视频片段的 `start/end` 挂在 entry 上，只对单个视频有意义。

## P7.1 一条记录多张照片

决策：
- `mediaId` → `mediaIds: string[]`（Entry 与 Candidate 都改），每条上限 **9**，顺序即展示顺序，第一张为封面。
- **视频仍然一条记录一个**：含视频时 `mediaIds.length === 1`，`start/end` 语义不变；多选时视频与照片混选 → 视频各自成条，照片合成一条。
- 不做向后兼容层，只在入口做一次归一化：旧数据 `mediaId: "x"` → `mediaIds: ["x"]`，删除 `mediaId` 字段。

任务：
- [X] P7.1.1 类型与归一化：改 `src/types.ts`；在 `domain/workspace-schema.ts` 的 load/parseBackup 里把旧 `mediaId` 迁移为 `mediaIds`；
  同步拉取（`domain/sync.ts` 合并入口）同样迁移，保证旧设备推上来的记录也能读。
  → 验证：新增 `tests/media-ids-migration.test.ts`，旧 workspace、旧备份 JSON、旧同步 payload 三种输入都得到 `mediaIds`。
- [X] P7.1.2 领域层：`media-refs.ts`（展开 `mediaIds`）、`records.ts`、`recap-draft.ts`、`seed.ts`、`lib/export.ts`（CSV 导出多图时用 `;` 连接或只计数，二选一，写在结果记录里）。
  → 验证：孤儿回收测试覆盖“删掉多图记录中的一张，只回收那一张”。
- [X] P7.1.3 存储与 workspace：`lib/storage.ts`、`lib/workspace.ts` 中保存/删除/补回原片逻辑按列表处理；补回原片（3.3 的能力）改为按单张操作。
  备份 JSON 版本号 +1，内嵌原片按 id 去重。
  → 验证：备份→恢复往返字节一致；删除记录时只删不再被其他记录引用的原片。
- [X] P7.1.4 导入：`<input type="file" multiple accept="image/*,video/*">`，照片合成一条候选（超 9 张提示并截断前 9 张），视频各自成条。
- [X] P7.1.5 编辑：`EntryEditor.vue` 支持加图（同样上限 9）、删图、左右移动改顺序（用按钮，不引入拖拽库）。
- [X] P7.1.6 展示：详情页横向 `scroll-snap` 滑动（纯 CSS），每张可点开 `PhotoZoom`；时间线/今天/待整理/回顾只显示封面 + 「+N」角标。
- [ ] P7.1.7 回归：269 项测试、`npm run build`（含 vue-tsc）全通过；375/320px 桌面浏览器无横向溢出已实测；**iPhone Safari 真机多选导入待用户实测**。

## P7.2 原片存 ECS 本机磁盘

决策：
- 存储：ECS 本机目录 `/var/lib/babytime/media/<id>`（原片）与 `<id>.thumb`（缩略图），不引入 OSS/新依赖。
- 范围：**先只同步照片与缩略图，视频仍只存本机**（体积大、带宽小）。
- 下载策略：先拉缩略图，点开大图或详情页时再按需拉原片；本机 IndexedDB 永远优先。
- 鉴权沿用同步服务的家庭密钥（与 `server/sync.ts` 现有校验同一函数，`timingSafeEqual`）。
- 成本估算：约 3 MB/张、3000 张/年 ≈ 9 GB/年，系统盘足够；以后迁 OSS 只换服务端存储实现。

任务：
- [X] P7.2.1 服务端（`server/sync.ts`，仍只用 Node 标准库）：
  - `PUT /sync/media/:id?variant=original|thumb`：流式写入临时文件再 `rename`（原子），单文件上限 20 MB（超出 413），id 只允许 UUID 格式（防路径穿越），
    记录 sha256 与大小到 SQLite 新表 `blobs(id, variant, size, sha256, updated_ms)`；同 id 重复上传幂等。
  - `GET /sync/media/:id?variant=...`：带 `Content-Type`、`ETag`(sha256)、`Cache-Control: private, max-age=31536000, immutable`。
  - `HEAD` 或批量 `POST /sync/media/exists` 返回服务器已有的 id，供客户端跳过已传。
  - 墓碑：media 记录被删除且超过 `TOMBSTONE_TTL_MS` 时随清理删除磁盘文件。
  - 媒体目录通过环境变量 `BABYTIME_MEDIA_DIR` 配置。
  → 验证：`tests/sync-server*.test.ts` 新增：上传/下载往返、超限 413、非法 id 400、无密钥 401、幂等、墓碑清理删文件。
- [X] P7.2.2 部署（`scripts/deploy-remote.sh`）：新增 `location /sync/media/ { client_max_body_size 20m; proxy_request_buffering off; ... }`，
  创建 `/var/lib/babytime/media`（属主为 sync 服务用户），systemd unit 加 `BABYTIME_MEDIA_DIR`。
  → 验证：`bash -n`；生成的 Nginx 配置除新增 location 外与改前一致。
- [X] P7.2.3 客户端（`lib/sync-service.ts` + `lib/storage.ts`）：
  - 上传队列：同步成功后找出本机有、服务器没有的照片（先 exists 批查），串行上传（并发 1，避免占满小带宽），失败下次同步重试；进度存 localStorage。
  - 下载：拉到新 media 元信息后只拉缩略图写入 IndexedDB；`MediaTile`/`PhotoZoom` 在本机无原片时按需拉原片并缓存。
  - 离线或服务未配置时行为与现在完全一致。
  → 验证：单测覆盖队列去重/重试；两个来源（127.0.0.1 与 localhost）实测：A 导入照片 → B 同步后看到缩略图，点开看到原片且字节一致。
- [X] P7.2.4 家庭页文案：说明“照片会存到你自己的服务器，视频只存本机”，并显示待上传数量；隐私说明同步更新。
- [ ] P7.2.5 回归：本地全部测试 + build 已通过；**用户在服务器部署后用两台手机实测、`du -sh /var/lib/babytime/media` 记录占用待完成**。
- [X] P7.2.6 历史照片补传（同日追加）：开启同步后自动补传本机已有照片（含升级前导入、库内没有缩略图的旧数据）；
  原片已在服务器但缩略图缺失的单独补传（缺缩略图时现场生成再传）；超过 20 MB 的照片单独计数并在家庭页说明，不再静默跳过。
  → 验证：按旧版形态注入照片后走界面开启同步，服务器出现 `<id>`（74 B）与 `<id>.thumb`（760 B），另一来源取回的原片逐字节一致；注入 21 MB 照片显示 `oversized:1`。

## 风险与回滚

- 数据结构迁移是单向的（旧版前端读不到 `mediaIds`）：P7.1 上线前先导出一次备份 JSON；回滚 = 部署旧版前端 + 恢复该备份。
- 服务器磁盘单点：本机备份导出功能保留，文案提醒定期导出。
- 带宽：串行上传 + 缩略图优先；如仍慢，再考虑 OSS 直传。

## 执行结果（2026-11-08）

- CSV 导出多图选「只计数」：新增末尾「照片数」列，不写素材 id、不导出原片；图文回顾 HTML 改为一张记录输出全部照片缩略图并标注「本条共 N 张照片」。
- 备份 JSON 版本升到 2（仍接受版本 1 并迁移）；`导出旧格式` 会写回 `mediaId` + 版本 1，供部署旧版前端回滚，新版前端也能读回。内嵌原片按 id 去重。
- 迁移入口三处：`load` / `restore` / 多标签刷新（本机）、`parseBackupContent`（备份）、`applyPull`（旧设备同步 payload）；推送与内容指纹统一补 `mediaIds: []`，避免迁移产生来回推送。
- 删除原片只删这条记录独有的素材：已确认/已忽略候选的残留引用会同步清掉，其它记录仍在用的原片保留。
- 回归：269 项测试全通过、`vue-tsc --noEmit` 0 错误、`vite build` 成功、`bash -n` 两个部署脚本通过；ip / ip-https / domain 三种模式生成的 Nginx 配置除新增 `/sync/media/` location 外与改前逐字节一致。
- 浏览器实测（Tabbit CLI，真实 IndexedDB）：375/320px 五页无横向溢出；一次导入 2 张 PNG 合成 1 条候选并显示「+1」；编辑弹窗 2 个素材槽、左右移动/删除/换图按钮齐全；详情页 `scroll-snap: x mandatory`、2 张可分别点开大图；无 `pageerror`。另用 127.0.0.1 与 localhost 两个来源 + 本机同步服务实测：A 导入并确认 → 同步上传原片/缩略图，B 同步后拉到缩略图，点开大图按需取回原片，74 字节与 A 逐字节一致。所有验证写入均已还原并复核条数。
- 仍需用户：iPhone Safari 真机多选导入；服务器部署后两台手机实测与磁盘占用记录。
- 历史照片补传（P7.2.6）：原片队列本来就覆盖全部本机照片，原缺陷在缩略图——只在首次上传原片时顺带传，原片已在服务器而缩略图缺失就再也补不上；超 20 MB 的照片也被静默排除。现在同时批查 `original` 与 `thumb`：缺原片传原片，缺缩略图单独补传（本机没有就用 `createImageThumbnail` 从原片现场生成，解不出的 HEIC 只传原片），每传一张写一次进度；超限改为 `oversized` 计数并在家庭页显示，同步设置弹窗补一句「开启后本机已有照片也会补传，视频不动」。
