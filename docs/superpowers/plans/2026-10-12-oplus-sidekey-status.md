# oplus-sidekey 续接与验收记录

更新：2026-10-13（Asia/Shanghai）。对应[实施计划](./2026-10-12-oplus-sidekey.md)与[批准设计](../specs/2026-10-12-oplus-sidekey-design.md)。

## 当前结论

唯一Superpowers计划的开发与本地验收已完成。Task0–9及最终审查两项Important均落实；独立任务审查和最终整分支审查Approved，可交付当前安装包。KernelSU/Ace6标准版真机验收仍单独列在下方，不作为已实测结论。

分支保留feat/oplus-sidekey，HEAD仍a327ebc；既有和本轮改动保留工作区，未自动提交、合并或推送。

## 完成清单

| 任务 | 最终状态 |
|---|---|
| 0 仓库与libevdev | 已完成，固定libevdev1.14.0及LF规则 |
| 1 主机框架 | 已完成，最终CTest9组通过 |
| 2 状态机 | 已完成，14序列及299/300/301边界、第三次松开与去重覆盖 |
| 3 配置 | 已完成，整份配置事务保留、UTF8命令拒绝与原生告警 |
| 4 扫描 | 已完成，按735能力首个匹配策略保持 |
| 5 守护进程 | 已完成，单调事件时间、排空后到期、旧队列丢弃与同步丢失处理 |
| 6 模块脚本 | 已完成，安装/服务/卸载语法和LF通过 |
| 7 WebUI | 已完成，配置安全加载/重试、原子保存四反馈、停止确认、511字节校验 |
| 8 打包 | 已完成，新ARM64和WebUI打包，9条目与module逐字节一致 |
| 9 浏览器 | 已完成，root警告/非KSU降级/14绑定/19disabled/7标识/300ms/日志空态 |

## 两项最终修复

1. **输入事件时序**：[输入接入](../../../daemon/src/sidekey_input.c)复用libevdev的CLOCK_MONOTONIC真实事件时间推进FSM；排空队列后才按当前时间结束窗口。测试覆盖延迟/批量、72事件、窗口与长按边界、过滤、旧时钟与SYN_DROPPED。[守护进程](../../../daemon/src/main.c)设置时钟失败发生在grab之前，启动期间保守丢弃待处理事件。
2. **超长命令**：[C解析器](../../../daemon/src/sidekey_config.c)与[前端配置](../../../webui/src/lib/config.ts)统一每条命令最多511个UTF8字节，超限拒绝，不执行截断前缀。原始长度先验再copy，失败保持整份旧配置；[WebUI](../../../webui/src/App.tsx)加载超限禁编辑/保存并可重试，保存超限不发写入exec；原生明确记录拒绝和skipped_lines告警。

两个独立门审查均spec compliant/quality Approved；最终整分支integrated gate Approved，无Critical/Important/新增Minor。

## 最终验证

- WebUI：99/99，5文件（config30、App28、daemon31、log7、ksu3）。
- lint：4 warnings、0 errors；TypeScript+Vite构建通过。
- canonical主机CTest：9/9，包含真实输入接入和生产main配置加载器；3个模块脚本sh -n通过。
- NDK构建通过：ARM aarch64 PIE、Android29、linker64、NDKr28c；BuildID：d7591e725f5e97e903da323aeca36e4312b1578a。
- 两项修复与生产加载器诊断均保留RED/GREEN证据；最终套件对整合源码执行。
- ZIP根metadata/9条目/正斜杠、全module文件字节一致、脚本与webroot LF、本地CSS及相对assets均通过。
- 最终资源index-WLvgQogR.js、CSS、HTML全部HTTP200；普通浏览器本页未发现JavaScript异常，外部扩展错误独立区分。
- 自有byti会话、pwsh-96临时服务已关闭，18765无监听；没有操作用户已有服务器。

## 安装包

[oplus-sidekey-0.1.0.zip](../../../dist/oplus-sidekey-0.1.0.zip)，180875字节。

SHA256：EE963C124898B4D284F03571B41601A8D6D85FE24A8229164F504910CEC8C7EB。

命令仍以root执行；长度限制不提供命令沙箱，请只绑定自己信任的命令。

## 已知非阻塞事项

- 前端4个lint提示：两个UI组件导出、两个异步挂载effect提醒。
- GNU在加载器测试include原main时，对既有扫描日志snprintf的潜在路径裁剪提出警告，构建与测试通过。
- 既有日志Minor：fork失败/信号终止等负result仍统一记dropped，不能据该字段区分无绑定与执行失败；不属于本次两项修复。

## 真机待验

以下项目仍需KernelSU/Ace6标准版实测：

- [ ] 安装并重启，确认PID和启动日志。
- [ ] 时钟ioctl成功、EVIOCGRAB生效、侧键原生动作不再触发。
- [ ] 单击/双击/长按/三击及混合序列，在实际负载下分类正确；同步丢失时不完整序列不执行。
- [ ] WebUI旧配置回显、保存/热加载日志确认config reloaded、超限拒绝且旧配置保留。
- [ ] 启停状态正确，SIGTERM后独占释放、原生行为恢复。
- [ ] 禁用并重启不启动。
- [ ] 卸载后守护进程/模块目录无残留、原生行为恢复。
