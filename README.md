# Zephyr

Minecraft Java 版桌面启动器的开发版源码。现有功能包括独立实例、Mojang 版本目录、游戏文件下载与校验、Microsoft 浏览器登录、正版所有权校验和现代原版的 Java 进程启动。当前处于开发阶段，真实账号到游戏内的完整流程尚未验收。

## 开发

安装 Node.js 24，在本目录执行：

```sh
npm ci
npm run check
npm start
```

实例数据写入 Electron 的用户数据目录下的 `launcher-data`。每个实例有独立游戏目录。下载队列最多并发处理 6 个文件，失败后重试会复用此前通过 SHA-1 校验的文件。速度、暂停和单文件断点续传尚未实现。

如需运行游戏，请安装该版本元数据指定的 Java 主版本。确保 `java` 在 PATH 中，或在启动器的环境中用 `MINECRAFT_JAVA` 设置 Java 可执行文件的绝对路径。目前需要现代版本的结构化启动参数和可通过类路径加载的原生库。部分历史版本可以下载，启动仍需补齐参数与原生库解包。

## Fabric、模组和 e4mc

1. 创建实例时选择 Fabric，再下载游戏文件。启动器从 Fabric Meta 选择稳定加载器，从 Maven 校验并下载所需库。首次成功安装后，实例保留原加载器版本。
2. 选中已安装的 Fabric 实例，在 Modrinth 模组区搜索资源。安装前会列出匹配当前 Minecraft 版本的模组和必需依赖，确认后才下载。文件须来自 Modrinth CDN 并通过大小与 SHA-1 校验。
3. Sodium 和 e4mc 可以从快捷入口预览安装。安装 e4mc 后，在游戏内通过原版的「对局域网开放」启用，联机地址由模组在游戏内显示。启动器目前负责安装，尚未提供地址提取或联机状态检测。

当前只自动选择正式发布的 Fabric 模组版本。需要不同版本的已安装依赖会提示冲突；手工放入的 JAR、反向冲突和第三方未声明的冲突仍需另外验证。模组升级和卸载尚无界面。

## Microsoft 开发授权

1. 在 Microsoft Entra 应用注册中创建支持个人 Microsoft 账号的应用，配置移动和桌面应用的公共客户端平台。注册与实现一致的回环重定向 URI `http://127.0.0.1/callback`。运行时使用系统选定的回环端口。若门户不接受 IP 回环 URI，可使用应用清单配置该 URI。
2. 按 Minecraft 的第三方应用授权要求提交自己的客户端 ID，确认它获准调用 Minecraft Services。
3. 将已获授权的应用程序客户端 ID 放进启动器进程的环境变量 `MINECRAFT_CLIENT_ID`。登录使用系统浏览器和 PKCE，无需提供密码或客户端密钥。当前会话凭据仅驻留在启动器内存中，关闭后需重新登录。

官方参考：[Microsoft 回环重定向 URI](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions) · [Minecraft 第三方应用申请入口](https://aka.ms/mce-reviewappid)

## 打包

在目标系统执行 `npm run check`，然后执行 `npm run package -- --x64` 或 `npm run package -- --arm64`。输出目录是 `release/`。

| 系统 | 配置目标 | 实机验证 |
| --- | --- | --- |
| Windows x64 / ARM64 | NSIS、便携 EXE | 待验证 |
| macOS Intel / Apple Silicon | DMG | 待验证 |
| Linux x64 / ARM64 | AppImage、DEB | Linux x64 AppImage 和 DEB 已构建，Electron 无头界面和 IPC 检查通过 |

将此目录作为独立仓库根目录即可使用随附的 GitHub Actions 构建矩阵。正式发布仍需品牌与项目地址、有效的维护者联系方式、签名和 macOS 公证。当前包的维护者邮箱是保留域占位。

## 验证和剩余范围

- 11 项自动化测试覆盖路径限制、平台规则、HTTP 安装及损坏文件校验、正版所有权、启动参数、Fabric 配置继承和 Modrinth 依赖校验。TypeScript 检查和前端生产构建通过。
- 云机代理拒绝访问 Mojang、Fabric Meta、Fabric Maven 和 Modrinth。缺少已获授权的 Microsoft 客户端 ID 和正版测试账号，真实下载、登录及游戏内验收待完成。
- Linux 上使用 Electron 无头模式完成了窗口渲染、预加载通信、空实例列表及渲染进程隔离的冒烟测试。Windows、macOS 和游戏内测试仍待完成。
- 待实现：Forge / NeoForge / Quilt、Java 自动安装、可持久化多账号和自动刷新、CurseForge、整合包安装、Terracotta 与 e4mc 联机状态和跨地区验收、模组同步、备份恢复、日志诊断、辅助模组、主题语言设置和签名更新。
- 联机源码仅作为后续参考。陶瓦采用 AGPL-3.0-or-later 并有针对未经修改二进制与进程间接口的例外。e4mc 和 Sodium 由用户确认后从 Modrinth 下载，EasyTier 尚未集成。Electron、React 及构建工具版本见锁文件。

## 0.2.0 性能与界面

- 新增深色、浅色和系统主题、macOS 原生背景材质、网页层模糊和低性能设备动效降级。Z 图标根据供稿外观重绘。
- 极速、平衡、画质预设只用于 Fabric。安装前显示检测到的版本、必需依赖及跳过原因。选择平衡或画质后可使用自己放入的 Iris 光影 ZIP。启动器按预设设置渲染距离和模拟距离，保留游戏分辨率。手动模式停用预设目录及参数，保留磁盘和现有游戏设置。
- Apple Silicon 优先自动查找原生 ARM64 Java，检查真实 Java 版本和架构。自动分配内存上限为系统内存约 40%，限制在 1–8 GB。
- 下载支持校验缓存和基于 Range 的恢复。服务器不支持 Range 时重新下载该文件。进度显示为已处理的文件数和任务平均吞吐。
- 新版发布由版本标签触发，目标为 macOS ARM64 DMG、Windows x64 EXE 和 Linux x64 AppImage。macOS 预览包使用临时签名。Developer ID 签名和 Apple 公证需要发布账号及对应凭据。
- 模组兼容性依据 Modrinth 的版本、加载器与声明的依赖和冲突。未测游戏实机帧率；第三方光影和手动安装的模组需在实际游戏中验证。

## Zephyr 0.2.4

- 资源中心无需安装实例即可浏览 Modrinth 模组、光影、材质包和整合包。详情包含上游截图、支持版本和简介。简介可尝试设备内建英语转中文模型；环境没有模型时，可主动在 Google 翻译打开简介。
- 安装前验证目标实例和下载完整性。模组需要 Fabric；光影 ZIP 对应 Iris，安装后在游戏或性能页选择。整合包仅处理声明了匹配 Minecraft 和 Fabric Loader 版本的 Modrinth MRPACK，限兼容的依赖与覆盖文件，遇到已有文件会拒绝覆盖，建议使用空实例。
- 在线登录使用 Microsoft 官方浏览器页面，保留所有权验证。发布者可在 GitHub 仓库 Actions **变量**配置公开的 `MINECRAFT_CLIENT_ID`，为用户预配已获授权的客户端 ID。未预配时可在「账号 → Microsoft 应用配置」填入自己的应用客户端 ID。
- 离线游玩输入昵称即可启动已安装的本地单人游戏，无需 Microsoft 账号。离线 UUID 由昵称确定，保留相同昵称可继续使用原有身份。离线模式不携带正版在线令牌。
- 账号页支持当前皮肤预览、本地 PNG 预览和提交至正版账号。游戏自带皮肤从已安装的正版来源客户端 JAR 读取，取决于目标版本，不额外随启动器分发贴图。离线模式仅预览皮肤。

## Zephyr 0.2.5

资源中心可在 Modrinth 和 CurseForge 间切换。CurseForge 使用官方 API，需在应用内输入自己的 API Key，或在启动器进程中配置 `CURSEFORGE_API_KEY`。应用内设置使用系统钥匙串加密，API Key 不随安装包分发。作者限制第三方下载时，可以打开官方项目页。CurseForge 整合包须与目标 Minecraft/Fabric Loader 版本匹配，遇到未授权文件或覆盖冲突会停止安装。

## Zephyr 0.2.6

Microsoft 登录默认弹出独立窗口，请求微软官方账号选择页面，保留系统浏览器入口。首次使用仍需完成 Microsoft 应用配置。窗口不加载启动器的预加载脚本，登录流程保留 PKCE 和正版校验。

「好友联机」可为已安装的 Fabric 实例下载 e4mc。只有从联机页选择启动联机实例时，Zephyr 管理的 e4mc 目录才会加载。房主需在游戏内手动对局域网开放，地址出现后只分享给认识的人。加入者可在支持 Quick Play 的已安装实例里使用好友提供的 e4mc 地址。两条联机路径均要求在线正版账号。「离线游玩」继续面向本地单人。陶瓦尚未集成。

## Zephyr 0.2.7

- 资源中心可查看总页数、直接点页码或输入页码跳转。列表遵循平台搜索偏移限制。
- 「外观」支持液态玻璃、简洁、经典三种界面风格，自定义强调色，分别调整界面和图片的不透明度。完全透明按钮同时隐藏背景图，保留交互控件。桌面透视效果依赖操作系统窗口合成。
- 自定义壁纸通过本机图片选择器导入。可在应用内打开 Minecraft 官方素材页面。版本不会额外分发未核实授权的图片。

## Zephyr 0.2.8

发布包预置 Zephyr 的 Microsoft 应用客户端 ID。直接点击「打开 Microsoft 登录窗口」即可开始。此前保存在本机的自定义客户端 ID 和发布时的仓库配置仍可以覆盖默认值。Microsoft 的账号所有权校验继续生效。
