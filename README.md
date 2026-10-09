# water-gas-surge

把微信小程序里的家庭天然气 / 自来水数据接入 Home Assistant / HomeKit 的 Surge 方案。

当前阶段：**正式版 v1**（面板核对阶段，Home Assistant 上报在下一版）。

## 正式版 v1

- 模块地址：`https://raw.githubusercontent.com/duduskying/water-gas-surge/main/wg-prod.sgmodule`
- 安装前先停用全部测试模块（v1 / v2 / v3）。
- 自来水初始化：Safari 打开 `https://example.com/wg-setup`，粘贴从 Reqable 复制的 ntAuth 值并保存（只存手机本地）。
- 燃气初始化：打开一次燃气小程序，点进购气记录 / 用量页面。
- 手动触发采集验证：Surge 脚本列表里运行 WG-Gas-Cron 与 WG-Water-Cron（或用 surge:///run-cron?name=WG-Water-Cron）。
- 核对：Surge 面板「水电气」，或 Safari 打开 `https://example.com/wg-report`（报告不含任何凭据值）。

## 定向测试模块 v3

- 模块地址：`https://raw.githubusercontent.com/duduskying/water-gas-surge/main/wg-test3.sgmodule`
- 相对 v2 的变化：自来水域名只挂请求侧脚本（排查响应侧脚本对该平台的影响）；燃气侧新增对载荷字段内层结构的解析（字段名与功能判别值）。
- 燃气测试时请点进账单 / 用气量 / 缴费记录等深层页面，而不只是首页。

## 定向测试模块 v2

- 模块地址：`https://raw.githubusercontent.com/duduskying/water-gas-surge/main/wg-test2.sgmodule`
- 只盯两个已定位的域名：燃气 `weixin.catrq.com`、自来水 `www.xazls.com`。
- 分开测试：先打开 `https://example.com/wg-reset` 清空，只操作一个小程序的各页面，再打开 `https://example.com/wg-report` 回传报告；另一个小程序重复一遍。
- v2 新增：请求序号与时间、白名单判别参数值（如 type / typeCode / flag，不含任何 ID 与密钥）、响应捕获加固与异常落盘。

## 测试模块

- 模块地址：`https://raw.githubusercontent.com/duduskying/water-gas-surge/main/wg-test.sgmodule`
- 在 iPhone Surge 中：配置 → 模块 → 安装新模块 → 输入上面的地址安装并启用。
- 前置条件：Surge MITM 已开启，且 Surge 的 CA 证书已安装并在系统设置中信任。

## 测试方法

1. 启用模块后，打开微信，分别进入燃气、自来水小程序，打开余额 / 用量 / 缴费记录等页面。
2. 发现带登录态且返回 JSON 的接口时，手机会收到“发现候选接口”通知。
3. 用 Safari 打开 `https://example.com/wg-report`，复制报告内容回传分析（清空数据：`https://example.com/wg-reset`）。
4. 测试完成后立即停用模块（模块使用全域 MITM，仅限测试窗口）。

## 隐私设计

测试脚本只记录：域名、路径（参数值脱敏）、参数名、请求头名、Cookie 名（不含值）、响应 JSON 字段名。
不记录：Cookie 值、token 值、户号、任何响应数据值。代码本身不包含任何账号信息与密钥。
