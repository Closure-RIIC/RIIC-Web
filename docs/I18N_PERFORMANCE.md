# 两站国际化性能记录

两站简体入口的传输量没有倒退，原有包体积门槛全部保留。桌面首页/手动页/技能页的 HTML、JS、CSS 冷加载传输量：方舟分别减少 9.0%、6.8%、5.0%，终末地分别减少 0.1%、12.6%、18.7%。方舟简体首页精确消息 JSON 从 139,700 降至 46,009 字节。

耗时存在成本：方舟定向复测中部分 hydration 增加约 19–101 ms、干员流程增加约 64–105 ms；终末地部分 hydration 增加约 14–70 ms，英文手机缓存干员弹窗增加约 159 ms。完整值和 p95 见下表，不据此宣称全站交互都更快。

基线 `7cd2d414ab737720aec63117d0edf935f4ce4ad9`；候选为 `feat/x18n-trilingual-20261029` 完成三语与 HTML 压缩后的本地生产产物。测量使用独立本地服务，方舟两边均开启 production、森空岛和云同步开关。Node v22.19.0，Windows，Chromium 156.0.8078.4。每个场景 10 次，交替基线和候选顺序，报告中位数 / p95。

发布前随后修正了少量遗漏的语言参数、弹窗关闭标签、职业编号常量及服务端工具的词条初始化，资源拆分与压缩策略未变。下表保留原采样构建证据；这些修订另做针对性回归与预算检查，没有重新采样全部页面，因此表格不是最终提交逐页重测的声明。

最终修订的方舟首页预算结果为 1,251,952 raw JS 字节、405,062 document preload gzip 字节；较采样构建分别增加 21 和 14 字节，原有 1,293,000 / 448,000 字节门槛均通过。

测量期间没有本任务的构建或功能测试并行运行；这仍是共享开发电脑，不是独占性能实验机。390px 是响应式视口，没有模拟手机 CPU 或移动网络。原始样本位于 `.tmp/i18n-performance-final.json`；可审查的汇总见 [i18n-performance-summary.json](i18n-performance-summary.json)。

页面导航使用匿名默认状态；账号弹窗亦为匿名。方舟干员编辑仅在导航采样后注入普通账号客户端 fixture，指标包含打开设置及选择“手动选择”的操作流程；终末地直接打开我的干员。没有连接真实账号、数据库或求解任务。

账号指标从点击“登录”开始；候选版本先展开账户菜单的操作不包含在该指标内。旧终末地 SSR 固定简体，旧方舟的游戏翻译资料在客户端补载；候选提供当前语种的 SSR 游戏文字，因此两版的功能覆盖和服务端工作量并非完全相同，不能将耗时差异全部归因于某个库。采样期间一次系统休眠导致请求失败，未完成的样本组已弃置重测；保留样本未见跨休眠的异常长耗时。

SSR 指标是本地 requestStart 到 responseStart 的 TTFB，包含 HTTP 和框架开销；hydration 指标是既有 `data-app-hydrated` 标记出现的时间，不能等同全部异步功能加载完成。网络字节在该标记后的绘制帧采集，只统计本站 HTML、JS、CSS，不包含图片、字体或业务 API。静态资源压缩在计时区间外计算；首次资源加载的额外成本保留。

## 终末地传输回归的修正

首轮确认终末地动态 HTML 没有 Content-Encoding，新增的 SSR 消息以原文传输；JS/CSS 的压缩体积只增加约 2%。提取方舟既有的流式 gzip 为共享工具后，终末地复用相同处理，权限、Cookie 与私有缓存规则保持原语义。下表使用浏览器的实际传输记录（KiB），每组10次的中位数。

| 终末地桌面入口 | 原基线 | 加入三语但未压缩 HTML | 最终压缩后 |
| --- | ---: | ---: | ---: |
| zh-CN / | 351.9 | 410.7 | 351.5 |
| zh-CN /manual | 420.1 | 479.9 | 367 |
| zh-CN /skills | 432.7 | 488.5 | 352 |
| en / | 351.9 | 411.5 | 350 |
| en /manual | 420.1 | 481.2 | 365.4 |
| en /skills | 432.7 | 492.3 | 351 |

主表的终末地数据采用修正后的第二轮；方舟的 gzip 行为和客户端产物未因共享函数提取而改变，其耗时增幅另做定向复测。

## 页面冷加载

单位：传输量 KiB，时间 ms；每格为基线 → 候选，各值为中位数 / p95。繁体没有旧版基线。

| 页面 | 首屏网络 KiB | SSR ms | hydration ms |
| --- | --- | --- | --- |
| arknights · zh-CN · 1440px · / | 465.9 / 465.9 → 423.7 / 423.7 | 22.3 / 36.2 → 25.7 / 36.8 | 596.5 / 668.4 → 612.5 / 704.7 |
| arknights · zh-CN · 1440px · /manual | 565 / 565 → 526.6 / 531.5 | 26.9 / 43.1 → 20.3 / 29.9 | 511.1 / 543.6 → 494.6 / 561.9 |
| arknights · zh-CN · 1440px · /skills | 533.8 / 533.8 → 507.1 / 507.5 | 57.7 / 81 → 52.7 / 79.8 | 1142.5 / 1261.6 → 1201.9 / 1287.2 |
| arknights · zh-CN · 390px · / | 465.9 / 465.9 → 423.7 / 423.7 | 25.4 / 32.2 → 23.8 / 27.4 | 563.5 / 602 → 564.4 / 619.8 |
| arknights · zh-CN · 390px · /manual | 565 / 565 → 526.6 / 531.5 | 26 / 34.2 → 26.2 / 62.1 | 464.6 / 508.8 → 483.2 / 522 |
| arknights · zh-CN · 390px · /skills | 529.7 / 529.7 → 497.7 / 502.7 | 41.7 / 59.2 → 63.4 / 68.8 | 806.9 / 867.9 → 823.7 / 882.8 |
| arknights · en · 1440px · / | 461 / 529.2 → 458.7 / 481.1 | 25.8 / 92.5 → 34.6 / 49.9 | 602.2 / 699.7 → 629.5 / 730.3 |
| arknights · en · 1440px · /manual | 560.1 / 560.1 → 529.8 / 529.8 | 21.4 / 31.2 → 24.2 / 28.8 | 508.2 / 555.2 → 523.1 / 578.3 |
| arknights · en · 1440px · /skills | 554.5 / 554.5 → 537.4 / 559.8 | 45 / 64.6 → 49.6 / 73.4 | 1138.8 / 1232.3 → 1162.7 / 1257.8 |
| arknights · en · 390px · / | 461 / 461 → 458.7 / 484.4 | 14.9 / 18.3 → 19.2 / 30.8 | 377.9 / 453.2 → 398.5 / 437.9 |
| arknights · en · 390px · /manual | 560.1 / 617.2 → 529.8 / 552.3 | 14 / 20 → 12.7 / 20.7 | 333.5 / 380.1 → 329.8 / 342 |
| arknights · en · 390px · /skills | 550.4 / 550.4 → 532.6 / 555 | 28.4 / 32.3 → 34.2 / 77.5 | 564.3 / 710.9 → 569.9 / 631.2 |
| arknights · zh-TW · 1440px · / | — → 458.2 / 458.2 | — → 18.2 / 33.7 | — → 431.6 / 465.3 |
| arknights · zh-TW · 1440px · /manual | — → 531.7 / 551.7 | — → 13.5 / 16.2 | — → 349.9 / 389.8 |
| arknights · zh-TW · 1440px · /skills | — → 536.5 / 556.8 | — → 29.9 / 31.6 | — → 828.7 / 853.8 |
| arknights · zh-TW · 390px · / | — → 458.2 / 459.2 | — → 17.5 / 24.8 | — → 399.8 / 437.2 |
| arknights · zh-TW · 390px · /manual | — → 541.7 / 551.7 | — → 11.3 / 17.8 | — → 323.8 / 367.1 |
| arknights · zh-TW · 390px · /skills | — → 531.9 / 531.9 | — → 26 / 30.8 | — → 581.5 / 659.1 |
| endfield · zh-CN · 1440px · / | 351.9 / 351.9 → 351.5 / 351.5 | 6.9 / 10.5 → 11.1 / 12.8 | 286 / 304 → 310.1 / 344.7 |
| endfield · zh-CN · 1440px · /manual | 420.1 / 420.1 → 367 / 367 | 16.3 / 23.3 → 21 / 42 | 442.9 / 480.4 → 472 / 537.4 |
| endfield · zh-CN · 1440px · /skills | 432.7 / 432.7 → 352 / 352 | 11.6 / 12.9 → 16.8 / 28.1 | 374.8 / 392.3 → 408.8 / 440.4 |
| endfield · zh-CN · 390px · / | 351.9 / 351.9 → 351.5 / 351.5 | 6.6 / 8.4 → 9.9 / 12 | 257.3 / 275.4 → 273.6 / 291.9 |
| endfield · zh-CN · 390px · /manual | 420.1 / 420.1 → 367 / 367 | 16.3 / 28.8 → 21.5 / 30.9 | 421.8 / 625.4 → 437.3 / 723.3 |
| endfield · zh-CN · 390px · /skills | 432.7 / 432.7 → 352 / 352 | 12.8 / 26.2 → 21.3 / 30.6 | 445.3 / 830.3 → 494.7 / 584.8 |
| endfield · en · 1440px · / | 351.9 / 351.9 → 350 / 350 | 7.5 / 13.9 → 11.2 / 22.5 | 342.6 / 437.7 → 334.4 / 555.6 |
| endfield · en · 1440px · /manual | 420.1 / 448.1 → 365.4 / 393.4 | 18.1 / 31.4 → 22.8 / 51 | 514 / 935.6 → 544.7 / 1011.1 |
| endfield · en · 1440px · /skills | 432.7 / 432.7 → 351 / 351 | 12.8 / 20.2 → 19.1 / 29.4 | 400.3 / 516.7 → 433.8 / 547.1 |
| endfield · en · 390px · / | 351.9 / 351.9 → 350 / 350 | 7.8 / 10.8 → 9.6 / 10.3 | 260.5 / 272.3 → 275.3 / 294.8 |
| endfield · en · 390px · /manual | 420.1 / 448.1 → 365.4 / 393.4 | 18.8 / 26.4 → 19 / 39.5 | 502.9 / 715.9 → 488.5 / 805.5 |
| endfield · en · 390px · /skills | 432.7 / 432.7 → 351 / 351 | 16.3 / 25.7 → 28.4 / 56.1 | 473.5 / 627.1 → 540.3 / 688.7 |
| endfield · zh-TW · 1440px · / | — → 351.6 / 351.6 | — → 21.1 / 33.7 | — → 558.9 / 761.8 |
| endfield · zh-TW · 1440px · /manual | — → 395.1 / 395.1 | — → 63.4 / 77.8 | — → 950.2 / 1011.3 |
| endfield · zh-TW · 1440px · /skills | — → 352.2 / 352.2 | — → 32.7 / 48.3 | — → 803.7 / 938.5 |
| endfield · zh-TW · 390px · / | — → 351.5 / 351.6 | — → 10.9 / 19 | — → 326.5 / 524.9 |
| endfield · zh-TW · 390px · /manual | — → 367.1 / 367.1 | — → 18.3 / 23.2 | — → 532.8 / 575 |
| endfield · zh-TW · 390px · /skills | — → 352.2 / 352.2 | — → 17.5 / 20.9 | — → 473.5 / 505.3 |

## 页面热加载

同一个浏览器上下文内刷新，缓存有效；每格为基线 → 候选，中位数 / p95。

| 页面 | 网络 KiB | SSR ms | hydration ms |
| --- | --- | --- | --- |
| arknights · zh-CN · 1440px · / | 58.9 / 58.9 → 25.5 / 25.5 | 35.7 / 66.4 → 34.5 / 53.9 | 326.8 / 430 → 345.3 / 406.7 |
| arknights · zh-CN · 1440px · /manual | 57.5 / 57.5 → 22.5 / 22.5 | 32.2 / 41.8 → 39.9 / 42.9 | 278.2 / 353.5 → 317.4 / 402.3 |
| arknights · zh-CN · 1440px · /skills | 63.8 / 73.2 → 32.3 / 32.3 | 68.6 / 103 → 78.7 / 170.1 | 776.8 / 849.9 → 838.6 / 1226.2 |
| arknights · zh-CN · 390px · / | 58.9 / 58.9 → 25.5 / 26.5 | 38.1 / 50.9 → 32.9 / 48.5 | 287.4 / 323.6 → 290.3 / 366.1 |
| arknights · zh-CN · 390px · /manual | 57.5 / 57.5 → 22.5 / 62.8 | 33.5 / 49 → 37.1 / 58 | 260.4 / 275.3 → 288.4 / 328.6 |
| arknights · zh-CN · 390px · /skills | 63.8 / 63.8 → 32.3 / 32.3 | 68.4 / 85.3 → 58.8 / 79.5 | 460.9 / 513 → 453.3 / 504.3 |
| arknights · en · 1440px · / | 54 / 54 → 55.5 / 61.9 | 32.3 / 58.9 → 52.3 / 63.9 | 318.4 / 388.5 → 346.2 / 402.3 |
| arknights · en · 1440px · /manual | 77.9 / 77.9 → 20.8 / 20.8 | 32.1 / 39.9 → 32.7 / 49.6 | 271 / 290.6 → 305.6 / 370.1 |
| arknights · en · 1440px · /skills | 59.3 / 94.5 → 62.2 / 62.2 | 64.4 / 95.9 → 68 / 84.3 | 771.9 / 922.6 → 813.8 / 960.2 |
| arknights · en · 390px · / | 54 / 54 → 55.5 / 55.5 | 16.9 / 49.2 → 23.2 / 40.8 | 176.4 / 264.1 → 201.7 / 269.4 |
| arknights · en · 390px · /manual | 77.9 / 77.9 → 20.8 / 25.3 | 15.1 / 18.1 → 18.1 / 38 | 161.8 / 181.6 → 192.3 / 216.3 |
| arknights · en · 390px · /skills | 59.3 / 59.3 → 62.2 / 62.2 | 34.6 / 53.1 → 47.3 / 68.9 | 302.8 / 360.8 → 338.4 / 369.6 |
| arknights · zh-TW · 1440px · / | — → 55.1 / 55.1 | — → 22.2 / 39.9 | — → 220.9 / 260.4 |
| arknights · zh-TW · 1440px · /manual | — → 22.6 / 22.6 | — → 19.6 / 30.6 | — → 202 / 226.8 |
| arknights · zh-TW · 1440px · /skills | — → 61.6 / 61.6 | — → 46.2 / 71.9 | — → 533.2 / 618.4 |
| arknights · zh-TW · 390px · / | — → 55.1 / 55.1 | — → 26.3 / 32.8 | — → 199.8 / 245.4 |
| arknights · zh-TW · 390px · /manual | — → 22.6 / 29.1 | — → 19.4 / 30.3 | — → 182.9 / 205.5 |
| arknights · zh-TW · 390px · /skills | — → 61.6 / 61.6 | — → 38.7 / 51.3 | — → 312.9 / 360.3 |
| endfield · zh-CN · 1440px · / | 351.9 / 351.9 → 351.5 / 351.5 | 6.2 / 9.4 → 10.1 / 11.6 | 140.1 / 169.7 → 155.5 / 231.9 |
| endfield · zh-CN · 1440px · /manual | 420.1 / 420.1 → 367 / 367 | 18.1 / 21.7 → 20.7 / 36.3 | 243.6 / 273.2 → 253.8 / 385.2 |
| endfield · zh-CN · 1440px · /skills | 432.7 / 432.7 → 352 / 352 | 11.1 / 12.3 → 16.4 / 31.8 | 182.3 / 191 → 203.8 / 232.3 |
| endfield · zh-CN · 390px · / | 351.9 / 351.9 → 351.5 / 351.5 | 6.8 / 8 → 8.3 / 10.1 | 120.6 / 140.9 → 124.8 / 142.5 |
| endfield · zh-CN · 390px · /manual | 420.1 / 420.1 → 367 / 367 | 16.2 / 34.9 → 20.7 / 57.1 | 213.9 / 407.3 → 235.3 / 413.2 |
| endfield · zh-CN · 390px · /skills | 432.7 / 432.7 → 352 / 352 | 15 / 31.3 → 23.1 / 39.8 | 214.8 / 467.2 → 249.7 / 338.9 |
| endfield · en · 1440px · / | 351.9 / 351.9 → 350 / 350 | 9.3 / 14.3 → 11.9 / 23.3 | 164.7 / 179.5 → 166.3 / 227.1 |
| endfield · en · 1440px · /manual | 420.1 / 448.1 → 365.4 / 365.4 | 27.8 / 65.3 → 30.1 / 50.9 | 349 / 621.9 → 354.2 / 584.7 |
| endfield · en · 1440px · /skills | 432.7 / 432.7 → 351 / 351 | 13.1 / 14.1 → 17.6 / 39.9 | 217.1 / 372.8 → 245.9 / 536.1 |
| endfield · en · 390px · / | 351.9 / 351.9 → 350 / 350 | 6 / 10.3 → 8.1 / 11.9 | 118.5 / 137.3 → 134.4 / 147.9 |
| endfield · en · 390px · /manual | 420.1 / 420.1 → 365.4 / 365.4 | 23.6 / 36.4 → 24.9 / 59.4 | 245.8 / 493 → 315.6 / 625.5 |
| endfield · en · 390px · /skills | 432.7 / 432.7 → 351 / 351 | 14.9 / 36 → 27.6 / 41 | 257.7 / 509 → 294.2 / 411 |
| endfield · zh-TW · 1440px · / | — → 351.6 / 351.6 | — → 16.8 / 24.4 | — → 273.2 / 357.9 |
| endfield · zh-TW · 1440px · /manual | — → 395.1 / 395.1 | — → 64 / 107.9 | — → 690.4 / 893.5 |
| endfield · zh-TW · 1440px · /skills | — → 352.2 / 352.2 | — → 35.5 / 47.8 | — → 444.2 / 549.7 |
| endfield · zh-TW · 390px · / | — → 351.5 / 351.6 | — → 11.5 / 21.9 | — → 163 / 217.8 |
| endfield · zh-TW · 390px · /manual | — → 367.1 / 367.1 | — → 21.7 / 32.4 | — → 280.3 / 315.1 |
| endfield · zh-TW · 390px · /skills | — → 352.2 / 352.2 | — → 17.3 / 27.4 | — → 248.5 / 280.6 |

## 弹窗与语言切换

单位 ms，中位数 / p95；从实际 click 事件到目标控件可用后的绘制帧，排除 Playwright 点击前的等待。语言切换的 cold 指首次切到未加载语种，warm 指切回已有语种。

| 场景 | 缓存 | 基线 → 候选 |
| --- | --- | --- |
| arknights · zh-CN · 1440px · /manual · 干员编辑 | roster-cold | 1550.9 / 2184.2 → 1693.1 / 2286.9 |
| arknights · zh-CN · 1440px · /manual · 干员编辑 | roster-warm | 1218.6 / 1266.2 → 1267.4 / 1387.9 |
| arknights · zh-CN · 1440px · /skills · 账号 | account-cold | 508.8 / 532.7 → 509.5 / 517.4 |
| arknights · zh-CN · 1440px · /skills · 账号 | account-warm | 162.5 / 188.9 → 172.3 / 197.2 |
| arknights · zh-CN · 1440px · /skills · 语言切换 | cold | — → 560.5 / 598 |
| arknights · zh-CN · 1440px · /skills · 语言切换 | warm | — → 347.9 / 425.1 |
| arknights · zh-CN · 390px · /manual · 干员编辑 | roster-cold | 1353.6 / 1425.5 → 1469.3 / 1893.1 |
| arknights · zh-CN · 390px · /manual · 干员编辑 | roster-warm | 957.1 / 1032.7 → 1045.6 / 1125.6 |
| arknights · zh-CN · 390px · /skills · 账号 | account-cold | 500.4 / 514.2 → 514.1 / 543.4 |
| arknights · zh-CN · 390px · /skills · 账号 | account-warm | 161.7 / 184.2 → 199.5 / 235.5 |
| arknights · zh-CN · 390px · /skills · 语言切换 | cold | — → 575.3 / 622.9 |
| arknights · zh-CN · 390px · /skills · 语言切换 | warm | — → 416.4 / 442.4 |
| arknights · en · 1440px · /manual · 干员编辑 | roster-cold | 1458.8 / 2277.3 → 1592.8 / 1667.7 |
| arknights · en · 1440px · /manual · 干员编辑 | roster-warm | 1203.2 / 1356.6 → 1268.7 / 1375.9 |
| arknights · en · 1440px · /skills · 账号 | account-cold | 498.8 / 529 → 480.9 / 500.2 |
| arknights · en · 1440px · /skills · 账号 | account-warm | 165.1 / 180.3 → 161.8 / 187.3 |
| arknights · en · 1440px · /skills · 语言切换 | cold | — → 668.5 / 712 |
| arknights · en · 1440px · /skills · 语言切换 | warm | — → 427.7 / 456.7 |
| arknights · en · 390px · /manual · 干员编辑 | roster-cold | 1132.9 / 1357.8 → 1144 / 1397.6 |
| arknights · en · 390px · /manual · 干员编辑 | roster-warm | 614.7 / 751 → 780.7 / 893.7 |
| arknights · en · 390px · /skills · 账号 | account-cold | 404.1 / 439.9 → 422.8 / 460.8 |
| arknights · en · 390px · /skills · 账号 | account-warm | 105.7 / 141.1 → 139.9 / 177.2 |
| arknights · en · 390px · /skills · 语言切换 | cold | — → 518.1 / 568.6 |
| arknights · en · 390px · /skills · 语言切换 | warm | — → 347.4 / 436.7 |
| arknights · zh-TW · 1440px · /manual · 干员编辑 | roster-cold | — → 1321.1 / 1405.5 |
| arknights · zh-TW · 1440px · /manual · 干员编辑 | roster-warm | — → 1090.1 / 1305.1 |
| arknights · zh-TW · 1440px · /skills · 账号 | account-cold | — → 432.3 / 467.4 |
| arknights · zh-TW · 1440px · /skills · 账号 | account-warm | — → 106.6 / 230.2 |
| arknights · zh-TW · 1440px · /skills · 语言切换 | cold | — → 453.6 / 503 |
| arknights · zh-TW · 1440px · /skills · 语言切换 | warm | — → 317.2 / 396.3 |
| arknights · zh-TW · 390px · /manual · 干员编辑 | roster-cold | — → 1157.8 / 1342.8 |
| arknights · zh-TW · 390px · /manual · 干员编辑 | roster-warm | — → 837.2 / 866 |
| arknights · zh-TW · 390px · /skills · 账号 | account-cold | — → 421.6 / 508.9 |
| arknights · zh-TW · 390px · /skills · 账号 | account-warm | — → 132.7 / 158.4 |
| arknights · zh-TW · 390px · /skills · 语言切换 | cold | — → 485.7 / 562.7 |
| arknights · zh-TW · 390px · /skills · 语言切换 | warm | — → 349.7 / 372.1 |
| endfield · zh-CN · 1440px · /manual · 干员编辑 | roster-cold | 951.5 / 1028.5 → 964.4 / 1052.3 |
| endfield · zh-CN · 1440px · /manual · 干员编辑 | roster-warm | 797.2 / 838.5 → 784 / 821.6 |
| endfield · zh-CN · 1440px · /skills · 账号 | account-cold | 412 / 456.7 → 420.8 / 439.1 |
| endfield · zh-CN · 1440px · /skills · 账号 | account-warm | 100.2 / 115.9 → 108.5 / 126.4 |
| endfield · zh-CN · 1440px · /skills · 语言切换 | cold | — → 179 / 202.3 |
| endfield · zh-CN · 1440px · /skills · 语言切换 | warm | — → 102.9 / 116.9 |
| endfield · zh-CN · 390px · /manual · 干员编辑 | roster-cold | 952.6 / 1376.8 → 984.4 / 1489.2 |
| endfield · zh-CN · 390px · /manual · 干员编辑 | roster-warm | 831.2 / 1194 → 834.7 / 1068.4 |
| endfield · zh-CN · 390px · /skills · 账号 | account-cold | 405.4 / 556 → 433.8 / 530.9 |
| endfield · zh-CN · 390px · /skills · 账号 | account-warm | 78.9 / 179.4 → 121.9 / 178.2 |
| endfield · zh-CN · 390px · /skills · 语言切换 | cold | — → 390.4 / 673.9 |
| endfield · zh-CN · 390px · /skills · 语言切换 | warm | — → 240.2 / 410 |
| endfield · en · 1440px · /manual · 干员编辑 | roster-cold | 1106.8 / 1410.9 → 1185.4 / 1782.6 |
| endfield · en · 1440px · /manual · 干员编辑 | roster-warm | 880 / 1109.6 → 881.2 / 1333.5 |
| endfield · en · 1440px · /skills · 账号 | account-cold | 432.6 / 501.8 → 455.2 / 665.7 |
| endfield · en · 1440px · /skills · 账号 | account-warm | 111.2 / 131.7 → 126.2 / 252.2 |
| endfield · en · 1440px · /skills · 语言切换 | cold | — → 255.7 / 519.1 |
| endfield · en · 1440px · /skills · 语言切换 | warm | — → 237.4 / 402.8 |
| endfield · en · 390px · /manual · 干员编辑 | roster-cold | 640.3 / 848.1 → 661.3 / 1147.4 |
| endfield · en · 390px · /manual · 干员编辑 | roster-warm | 509.5 / 1133.4 → 668.6 / 1339.1 |
| endfield · en · 390px · /skills · 账号 | account-cold | 463.1 / 507.5 → 436.6 / 472.1 |
| endfield · en · 390px · /skills · 账号 | account-warm | 137.3 / 183.2 → 171.4 / 268 |
| endfield · en · 390px · /skills · 语言切换 | cold | — → 525.9 / 744.7 |
| endfield · en · 390px · /skills · 语言切换 | warm | — → 356.4 / 424.2 |
| endfield · zh-TW · 1440px · /manual · 干员编辑 | roster-cold | — → 1560.3 / 1770.7 |
| endfield · zh-TW · 1440px · /manual · 干员编辑 | roster-warm | — → 1383.7 / 1520.7 |
| endfield · zh-TW · 1440px · /skills · 账号 | account-cold | — → 543.3 / 605.2 |
| endfield · zh-TW · 1440px · /skills · 账号 | account-warm | — → 293.8 / 355.4 |
| endfield · zh-TW · 1440px · /skills · 语言切换 | cold | — → 535.1 / 596.4 |
| endfield · zh-TW · 1440px · /skills · 语言切换 | warm | — → 379.8 / 447.1 |
| endfield · zh-TW · 390px · /manual · 干员编辑 | roster-cold | — → 1088.8 / 1223.9 |
| endfield · zh-TW · 390px · /manual · 干员编辑 | roster-warm | — → 928.8 / 1022.2 |
| endfield · zh-TW · 390px · /skills · 账号 | account-cold | — → 429 / 493.7 |
| endfield · zh-TW · 390px · /skills · 账号 | account-warm | — → 144.3 / 171.2 |
| endfield · zh-TW · 390px · /skills · 语言切换 | cold | — → 412 / 450.2 |
| endfield · zh-TW · 390px · /skills · 语言切换 | warm | — → 317.7 / 331.4 |

## 精确消息与产物体积

下表是服务器 loader 返回的消息 JSON，使用 UTF-8 字节计数，独立计算 gzip/Brotli；包含当前路由需要的游戏展示覆盖表。它与 HTML 内联 bootstrap（还包含路由和公共数据）不同，也不能与客户端全部资源混用。终末地旧版文案在 JavaScript 中，没有独立 SSR 消息对象。

| 应用 / 版本 | 语种 | 路由 | 原文 bytes | gzip bytes | Brotli bytes |
| --- | --- | --- | ---: | ---: | ---: |
| arknights / candidate | zh-CN | / | 46009 | 17177 | 14186 |
| arknights / candidate | zh-CN | /manual | 40494 | 15380 | 12653 |
| arknights / candidate | zh-CN | /skills | 48716 | 18069 | 14902 |
| arknights / candidate | zh-TW | / | 207885 | 43953 | 34603 |
| arknights / candidate | zh-TW | /manual | 40649 | 15502 | 12984 |
| arknights / candidate | zh-TW | /skills | 210592 | 44931 | 35323 |
| arknights / candidate | en | / | 252700 | 45322 | 36265 |
| arknights / candidate | en | /manual | 42653 | 13999 | 12022 |
| arknights / candidate | en | /skills | 255532 | 46519 | 37148 |
| endfield / candidate | zh-CN | / | 51828 | 11079 | 8656 |
| endfield / candidate | zh-CN | /manual | 53287 | 11515 | 9041 |
| endfield / candidate | zh-CN | /skills | 47630 | 9390 | 7244 |
| endfield / candidate | zh-TW | / | 51861 | 11115 | 8846 |
| endfield / candidate | zh-TW | /manual | 53311 | 11545 | 9215 |
| endfield / candidate | zh-TW | /skills | 47654 | 9413 | 7373 |
| endfield / candidate | en | / | 52667 | 9958 | 8279 |
| endfield / candidate | en | /manual | 54177 | 10404 | 8686 |
| endfield / candidate | en | /skills | 48332 | 8544 | 7069 |
| arknights / baseline | zh-CN | all | 139700 | 51070 | 41200 |
| arknights / baseline | en | all | 145371 | 46472 | 39006 |

方舟简体游戏覆盖表为空，复用既有业务资料；完整生成字典仍用于来源与覆盖校验。英语和繁体按当前语种加载。包体积预算通过，首页 raw JS 为 1,251,931 / 1,293,000 字节，document preload 为 405,048 / 448,000 gzip 字节，没有提高阈值。

最终构建日志记录的候选 Vite client / SSR / Nitro 阶段：方舟 20.21 / 12.03 / 12.15 s；终末地 7.75 / 3.83 / 7.57 s。这些不包括全部类型检查和后处理，不能作为完整构建时间或基线加速结论。

## 超过 5% 的耗时变化复测

方舟按首轮超过 5% 的场景单独重新采样 10 次。终末地的复测指启用 HTML 压缩后的第二轮，主表已采用同一批最终产物数据；不能再将两张表相加为独立样本数。以下保留对应耗时指标。

| 页面 / 缓存 | 指标 | 基线 → 候选，中位数 / p95 ms | 中位数变化 |
| --- | --- | --- | ---: |
| arknights · zh-CN · 1440px · / / false | ssrMs | 29.1 / 318.5 → 28.6 / 271.8 | -1.7% |
| arknights · zh-CN · 1440px · / / false | hydrationMs | 705.9 / 828 → 721.6 / 840.5 | 2.2% |
| arknights · zh-CN · 1440px · / / true | ssrMs | 40.5 / 87.6 → 38.3 / 69.3 | -5.7% |
| arknights · zh-CN · 1440px · / / true | hydrationMs | 382 / 459.6 → 364.8 / 520.4 | -4.5% |
| arknights · zh-CN · 1440px · /manual / false | ssrMs | 19.6 / 23 → 16.8 / 49.2 | -14.5% |
| arknights · zh-CN · 1440px · /manual / false | hydrationMs | 463.8 / 629.9 → 399.2 / 917.1 | -13.9% |
| arknights · zh-CN · 1440px · /manual / true | ssrMs | 21.1 / 34.5 → 29.3 / 148.1 | 38.5% |
| arknights · zh-CN · 1440px · /manual / true | hydrationMs | 229.8 / 291.5 → 236.4 / 524.1 | 2.9% |
| arknights · zh-CN · 1440px · /manual / roster-cold | rosterMs | 1389 / 2055.1 → 1494 / 2031.8 | 7.6% |
| arknights · zh-CN · 1440px · /manual / roster-warm | rosterMs | 1082.8 / 1111 → 1131.8 / 1195 | 4.5% |
| arknights · zh-CN · 1440px · /skills / false | ssrMs | 29.7 / 53 → 38.7 / 276.2 | 30.4% |
| arknights · zh-CN · 1440px · /skills / false | hydrationMs | 1013.8 / 1235.4 → 1025.5 / 2109.7 | 1.2% |
| arknights · zh-CN · 1440px · /skills / true | ssrMs | 63.3 / 144.1 → 66.8 / 138.2 | 5.7% |
| arknights · zh-CN · 1440px · /skills / true | hydrationMs | 654.7 / 938 → 756.1 / 1229.5 | 15.5% |
| arknights · zh-CN · 1440px · /skills / account-cold | accountMs | 447.6 / 496.2 → 479.1 / 815.3 | 7% |
| arknights · zh-CN · 1440px · /skills / account-warm | accountMs | 112.7 / 148 → 126.8 / 191.5 | 12.6% |
| arknights · zh-CN · 390px · /manual / false | ssrMs | 17.2 / 28.7 → 15.4 / 24.9 | -10.5% |
| arknights · zh-CN · 390px · /manual / false | hydrationMs | 372.4 / 892.5 → 348.8 / 547.6 | -6.4% |
| arknights · zh-CN · 390px · /manual / true | ssrMs | 17.3 / 32.6 → 28.9 / 63.7 | 67.3% |
| arknights · zh-CN · 390px · /manual / true | hydrationMs | 174.1 / 393.7 → 214.5 / 274.8 | 23.2% |
| arknights · zh-CN · 390px · /manual / roster-cold | rosterMs | 1236.2 / 1858 → 1299.8 / 1452.7 | 5.1% |
| arknights · zh-CN · 390px · /manual / roster-warm | rosterMs | 823.7 / 1116.8 → 900.3 / 1159.5 | 9.3% |
| arknights · zh-CN · 390px · /skills / false | ssrMs | 27.5 / 235.1 → 29.1 / 42.8 | 5.6% |
| arknights · zh-CN · 390px · /skills / false | hydrationMs | 544.3 / 1296.1 → 628.3 / 897.4 | 15.4% |
| arknights · zh-CN · 390px · /skills / true | ssrMs | 46.8 / 67.6 → 46 / 72.2 | -1.6% |
| arknights · zh-CN · 390px · /skills / true | hydrationMs | 291.1 / 424.6 → 337 / 679.3 | 15.8% |
| arknights · zh-CN · 390px · /skills / account-cold | accountMs | 405 / 469.3 → 448.5 / 552.3 | 10.7% |
| arknights · zh-CN · 390px · /skills / account-warm | accountMs | 101.9 / 148.3 → 150.6 / 190 | 47.8% |
| arknights · en · 1440px · / / false | ssrMs | 13.8 / 23.1 → 18.2 / 23.7 | 32.4% |
| arknights · en · 1440px · / / false | hydrationMs | 400.4 / 484.5 → 398 / 450.8 | -0.6% |
| arknights · en · 1440px · / / true | ssrMs | 16.4 / 31.1 → 23.3 / 67.3 | 42.8% |
| arknights · en · 1440px · / / true | hydrationMs | 184.8 / 214.3 → 204.6 / 302.1 | 10.7% |
| arknights · en · 1440px · /manual / false | ssrMs | 15.4 / 27.2 → 19 / 27.1 | 23.4% |
| arknights · en · 1440px · /manual / false | hydrationMs | 368.9 / 564.5 → 423.2 / 547.6 | 14.7% |
| arknights · en · 1440px · /manual / true | ssrMs | 17.4 / 31.8 → 22.5 / 28.9 | 29.7% |
| arknights · en · 1440px · /manual / true | hydrationMs | 210.6 / 314.9 → 243 / 292.7 | 15.4% |
| arknights · en · 1440px · /manual / roster-cold | rosterMs | 1401.8 / 1521.1 → 1335.5 / 1499.6 | -4.7% |
| arknights · en · 1440px · /manual / roster-warm | rosterMs | 1107.7 / 1245.5 → 1162.9 / 1341 | 5% |
| arknights · en · 1440px · /skills / false | ssrMs | 22.5 / 40.8 → 28.5 / 49.5 | 26.9% |
| arknights · en · 1440px · /skills / false | hydrationMs | 702.6 / 880.6 → 713.4 / 801.5 | 1.5% |
| arknights · en · 1440px · /skills / true | ssrMs | 45.7 / 58.3 → 52.5 / 83.6 | 14.9% |
| arknights · en · 1440px · /skills / true | hydrationMs | 457.9 / 526.3 → 478.5 / 516.9 | 4.5% |
| arknights · en · 390px · / / false | ssrMs | 13.8 / 16.3 → 15.3 / 21.2 | 10.9% |
| arknights · en · 390px · / / false | hydrationMs | 351.1 / 453.8 → 377.3 / 436.1 | 7.5% |
| arknights · en · 390px · / / true | ssrMs | 16.8 / 28.5 → 17.6 / 21.2 | 4.8% |
| arknights · en · 390px · / / true | hydrationMs | 173.9 / 216.8 → 176.2 / 262 | 1.3% |
| arknights · en · 390px · /manual / false | ssrMs | 18 / 25.9 → 13.4 / 18.7 | -25.3% |
| arknights · en · 390px · /manual / false | hydrationMs | 388 / 647.1 → 357.1 / 497.4 | -8% |
| arknights · en · 390px · /manual / true | ssrMs | 19.3 / 71 → 18.1 / 42.2 | -6.5% |
| arknights · en · 390px · /manual / true | hydrationMs | 189.5 / 438.6 → 208.8 / 248 | 10.2% |
| arknights · en · 390px · /manual / roster-cold | rosterMs | 1173 / 1722.4 → 1162.1 / 1284.9 | -0.9% |
| arknights · en · 390px · /manual / roster-warm | rosterMs | 778.2 / 950.3 → 866.4 / 1014.9 | 11.3% |
| arknights · en · 390px · /skills / false | ssrMs | 32.9 / 72.7 → 59.7 / 88.7 | 81.9% |
| arknights · en · 390px · /skills / false | hydrationMs | 781.7 / 1257.2 → 873 / 1076.9 | 11.7% |
| arknights · en · 390px · /skills / true | ssrMs | 67.6 / 117.3 → 106 / 188.1 | 56.8% |
| arknights · en · 390px · /skills / true | hydrationMs | 446.2 / 555.1 → 530.6 / 718.7 | 18.9% |
| arknights · en · 390px · /skills / account-cold | accountMs | 474.4 / 502.8 → 501.7 / 534.4 | 5.8% |
| arknights · en · 390px · /skills / account-warm | accountMs | 116.2 / 192.8 → 195.6 / 250.3 | 68.4% |
| endfield · zh-CN · 1440px · / / false | ssrMs | 6.9 / 10.5 → 11.1 / 12.8 | 62% |
| endfield · zh-CN · 1440px · / / false | hydrationMs | 286 / 304 → 310.1 / 344.7 | 8.4% |
| endfield · zh-CN · 1440px · / / true | ssrMs | 6.2 / 9.4 → 10.1 / 11.6 | 63.7% |
| endfield · zh-CN · 1440px · / / true | hydrationMs | 140.1 / 169.7 → 155.5 / 231.9 | 10.9% |
| endfield · zh-CN · 1440px · /manual / false | ssrMs | 16.3 / 23.3 → 21 / 42 | 29.2% |
| endfield · zh-CN · 1440px · /manual / false | hydrationMs | 442.9 / 480.4 → 472 / 537.4 | 6.6% |
| endfield · zh-CN · 1440px · /manual / true | ssrMs | 18.1 / 21.7 → 20.7 / 36.3 | 14.4% |
| endfield · zh-CN · 1440px · /manual / true | hydrationMs | 243.6 / 273.2 → 253.8 / 385.2 | 4.2% |
| endfield · zh-CN · 1440px · /manual / roster-cold | rosterMs | 951.5 / 1028.5 → 964.4 / 1052.3 | 1.4% |
| endfield · zh-CN · 1440px · /manual / roster-warm | rosterMs | 797.2 / 838.5 → 784 / 821.6 | -1.6% |
| endfield · zh-CN · 1440px · /skills / false | ssrMs | 11.6 / 12.9 → 16.8 / 28.1 | 44.4% |
| endfield · zh-CN · 1440px · /skills / false | hydrationMs | 374.8 / 392.3 → 408.8 / 440.4 | 9.1% |
| endfield · zh-CN · 1440px · /skills / true | ssrMs | 11.1 / 12.3 → 16.4 / 31.8 | 48% |
| endfield · zh-CN · 1440px · /skills / true | hydrationMs | 182.3 / 191 → 203.8 / 232.3 | 11.9% |
| endfield · zh-CN · 1440px · /skills / account-cold | accountMs | 412 / 456.7 → 420.8 / 439.1 | 2.1% |
| endfield · zh-CN · 1440px · /skills / account-warm | accountMs | 100.2 / 115.9 → 108.5 / 126.4 | 8.3% |
| endfield · zh-CN · 390px · / / false | ssrMs | 6.6 / 8.4 → 9.9 / 12 | 49.2% |
| endfield · zh-CN · 390px · / / false | hydrationMs | 257.3 / 275.4 → 273.6 / 291.9 | 6.4% |
| endfield · zh-CN · 390px · / / true | ssrMs | 6.8 / 8 → 8.3 / 10.1 | 22.2% |
| endfield · zh-CN · 390px · / / true | hydrationMs | 120.6 / 140.9 → 124.8 / 142.5 | 3.4% |
| endfield · zh-CN · 390px · /manual / false | ssrMs | 16.3 / 28.8 → 21.5 / 30.9 | 31.2% |
| endfield · zh-CN · 390px · /manual / false | hydrationMs | 421.8 / 625.4 → 437.3 / 723.3 | 3.7% |
| endfield · zh-CN · 390px · /manual / true | ssrMs | 16.2 / 34.9 → 20.7 / 57.1 | 27.8% |
| endfield · zh-CN · 390px · /manual / true | hydrationMs | 213.9 / 407.3 → 235.3 / 413.2 | 10.1% |
| endfield · zh-CN · 390px · /manual / roster-cold | rosterMs | 952.6 / 1376.8 → 984.4 / 1489.2 | 3.3% |
| endfield · zh-CN · 390px · /manual / roster-warm | rosterMs | 831.2 / 1194 → 834.7 / 1068.4 | 0.4% |
| endfield · zh-CN · 390px · /skills / false | ssrMs | 12.8 / 26.2 → 21.3 / 30.6 | 65.8% |
| endfield · zh-CN · 390px · /skills / false | hydrationMs | 445.3 / 830.3 → 494.7 / 584.8 | 11.1% |
| endfield · zh-CN · 390px · /skills / true | ssrMs | 15 / 31.3 → 23.1 / 39.8 | 54% |
| endfield · zh-CN · 390px · /skills / true | hydrationMs | 214.8 / 467.2 → 249.7 / 338.9 | 16.3% |
| endfield · zh-CN · 390px · /skills / account-cold | accountMs | 405.4 / 556 → 433.8 / 530.9 | 7% |
| endfield · zh-CN · 390px · /skills / account-warm | accountMs | 78.9 / 179.4 → 121.9 / 178.2 | 54.6% |
| endfield · en · 1440px · / / false | ssrMs | 7.5 / 13.9 → 11.2 / 22.5 | 49.7% |
| endfield · en · 1440px · / / false | hydrationMs | 342.6 / 437.7 → 334.4 / 555.6 | -2.4% |
| endfield · en · 1440px · / / true | ssrMs | 9.3 / 14.3 → 11.9 / 23.3 | 27.3% |
| endfield · en · 1440px · / / true | hydrationMs | 164.7 / 179.5 → 166.3 / 227.1 | 0.9% |
| endfield · en · 1440px · /manual / false | ssrMs | 18.1 / 31.4 → 22.8 / 51 | 26.6% |
| endfield · en · 1440px · /manual / false | hydrationMs | 514 / 935.6 → 544.7 / 1011.1 | 6% |
| endfield · en · 1440px · /manual / true | ssrMs | 27.8 / 65.3 → 30.1 / 50.9 | 8.1% |
| endfield · en · 1440px · /manual / true | hydrationMs | 349 / 621.9 → 354.2 / 584.7 | 1.5% |
| endfield · en · 1440px · /manual / roster-cold | rosterMs | 1106.8 / 1410.9 → 1185.4 / 1782.6 | 7.1% |
| endfield · en · 1440px · /manual / roster-warm | rosterMs | 880 / 1109.6 → 881.2 / 1333.5 | 0.1% |
| endfield · en · 1440px · /skills / false | ssrMs | 12.8 / 20.2 → 19.1 / 29.4 | 48.2% |
| endfield · en · 1440px · /skills / false | hydrationMs | 400.3 / 516.7 → 433.8 / 547.1 | 8.4% |
| endfield · en · 1440px · /skills / true | ssrMs | 13.1 / 14.1 → 17.6 / 39.9 | 34% |
| endfield · en · 1440px · /skills / true | hydrationMs | 217.1 / 372.8 → 245.9 / 536.1 | 13.2% |
| endfield · en · 1440px · /skills / account-cold | accountMs | 432.6 / 501.8 → 455.2 / 665.7 | 5.2% |
| endfield · en · 1440px · /skills / account-warm | accountMs | 111.2 / 131.7 → 126.2 / 252.2 | 13.6% |
| endfield · en · 390px · / / false | ssrMs | 7.8 / 10.8 → 9.6 / 10.3 | 23.9% |
| endfield · en · 390px · / / false | hydrationMs | 260.5 / 272.3 → 275.3 / 294.8 | 5.7% |
| endfield · en · 390px · / / true | ssrMs | 6 / 10.3 → 8.1 / 11.9 | 35% |
| endfield · en · 390px · / / true | hydrationMs | 118.5 / 137.3 → 134.4 / 147.9 | 13.4% |
| endfield · en · 390px · /manual / false | ssrMs | 18.8 / 26.4 → 19 / 39.5 | 1.3% |
| endfield · en · 390px · /manual / false | hydrationMs | 502.9 / 715.9 → 488.5 / 805.5 | -2.9% |
| endfield · en · 390px · /manual / true | ssrMs | 23.6 / 36.4 → 24.9 / 59.4 | 5.3% |
| endfield · en · 390px · /manual / true | hydrationMs | 245.8 / 493 → 315.6 / 625.5 | 28.4% |
| endfield · en · 390px · /manual / roster-cold | rosterMs | 640.3 / 848.1 → 661.3 / 1147.4 | 3.3% |
| endfield · en · 390px · /manual / roster-warm | rosterMs | 509.5 / 1133.4 → 668.6 / 1339.1 | 31.2% |
| endfield · en · 390px · /skills / false | ssrMs | 16.3 / 25.7 → 28.4 / 56.1 | 74% |
| endfield · en · 390px · /skills / false | hydrationMs | 473.5 / 627.1 → 540.3 / 688.7 | 14.1% |
| endfield · en · 390px · /skills / true | ssrMs | 14.9 / 36 → 27.6 / 41 | 84.9% |
| endfield · en · 390px · /skills / true | hydrationMs | 257.7 / 509 → 294.2 / 411 | 14.1% |
| endfield · en · 390px · /skills / account-cold | accountMs | 463.1 / 507.5 → 436.6 / 472.1 | -5.7% |
| endfield · en · 390px · /skills / account-warm | accountMs | 137.3 / 183.2 → 171.4 / 268 | 24.9% |

## CPU 诊断

另用 Node + Playwright/CDP 对方舟英文手机手动页、终末地英文桌面技能页及英文手机手动页各作三轮配对 CPU 采样。Profiler 本身有开销；以下为该次操作的累计主线程任务、JavaScript、布局和样式时间中位数，仅用于定位，不能替代上面的十轮真实计时或两者相加。

CPU 栈主要落在名单/账号组件、OverlayScrollbars 及 `getPropertyValue` 等样式测量。方舟缓存名单的 JavaScript、样式与布局均增加；终末地缓存名单和账号也有额外 JavaScript 工作，但若干首次操作的主线程总耗时反而下降。结果说明存在渲染和滚动测量成本，也存在场景波动，不能把所有差值单独归因于 use-intl。

服务器新增了当前语种资源组织、游戏词条序列化，终末地还新增动态 HTML gzip；这是与旧版本工作量不同的明确边界。这里没有服务端逐函数 CPU 火焰图，因此不对每个 TTFB 增幅作更细的因果断言。CDP 的累计计数在刷新时重置，首次诊断的热导航计数差无效，已从 CPU 表及机器汇总排除；前面的十轮导航耗时使用独立的浏览器时间标记，不受影响。

| 场景 | 主线程任务 ms | JavaScript ms | 布局 ms | 样式 ms |
| --- | --- | --- | --- | --- |
| arknights /manual nav-cold | 485.9 → 517.3 | 280.7 → 283.8 | 25.9 → 27.5 | 12 → 21.1 |
| arknights /manual roster-cold | 954.2 → 952.1 | 285.4 → 273.3 | 79 → 77.4 | 155.7 → 166 |
| arknights /manual roster-warm | 578.4 → 712.6 | 133.9 → 188.8 | 59.2 → 70.2 | 123.4 → 145.9 |
| endfield /skills nav-cold | 935.9 → 851.6 | 231.9 → 261.4 | 250.6 → 170.5 | 187 → 182.3 |
| endfield /skills account-cold | 388.4 → 313.6 | 65.7 → 81.2 | 32.3 → 24.9 | 40.4 → 29 |
| endfield /skills account-warm | 197.5 → 195.7 | 29 → 46.7 | 3.3 → 3.6 | 14.7 → 16.6 |
| endfield /manual nav-cold | 877.9 → 653 | 323.2 → 268.7 | 140.9 → 100.1 | 174 → 123.2 |
| endfield /manual roster-cold | 1030.8 → 1015.1 | 417.2 → 380.4 | 77.6 → 71.5 | 223.8 → 206.7 |
| endfield /manual roster-warm | 768.9 → 787.2 | 221.1 → 246.4 | 33.1 → 34.6 | 228.7 → 241.2 |

## 运行时选择

正式实现保留 use-intl。隔离的 13 条真实消息样例中，Paraglide 2.29.3 + ICU 插件 1.3.4 的三语入口 gzip 为 5,740 字节；use-intl 入口 14,578 字节，另有共享 chunk 361 字节和当前语言 chunk 715–877 字节。样例没有完成全站 SSR、富文本、状态保留适配，不能推导整站收益，也没有达到本计划要求的完整迁移决策证据。
