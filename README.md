# water-gas-surge

把微信小程序里的家庭天然气 / 自来水数据接入 Home Assistant / HomeKit 的 Surge 方案。

当前阶段：**可见性测试模块**（混合方案的第一步）。

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
