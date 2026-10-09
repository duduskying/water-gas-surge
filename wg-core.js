// 水电气正式版 - 核心脚本
// 燃气: 在途捕获(存会话与请求模板到手机本地) + 响应即时解析
// 页面: example.com/wg-setup 自来水令牌设置页 / example.com/wg-report 核对报告(不含任何凭据值)
(function () {
  var K_COOKIE = "wg_gas_cookie", K_TPL = "wg_gas_tpl", K_GAS = "wg_gas_data";
  var K_WTOKEN = "wg_water_token", K_WATER = "wg_water_data", K_WSTATUS = "wg_water_status";
  var REPORT_HOST = "example.com";
  var GAS_ENDPOINTS = [
    { key: "sales_summary", match: "/weixin/rs/sql/getSellinggas/n" },
    { key: "archive", match: "/weixin/rs/logic/getQueryData" },
    { key: "metergas", match: "/NewSaleRest/rs/logic/getMeterGas" },
    { key: "sales", match: "/weixin/rs/sql/getSellinggas" },
    { key: "compare", match: "/weixin/rs/sql/getCompareYearAnalysis" }
  ];
  function now() { return Math.floor(Date.now() / 1000); }
  function loadJ(key) { try { var s = $persistentStore.read(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(key, obj) { try { $persistentStore.write(JSON.stringify(obj), key); } catch (e) {} }
  function hostOf(url) { var m = /^(?:https?):\/\/([^\/:?#]+)/i.exec(url || ""); return m ? m[1].toLowerCase() : ""; }
  function pathOf(url) {
    var s = String(url || ""); var i = s.indexOf("://"); if (i >= 0) s = s.slice(i + 3);
    var j = s.indexOf("/"); s = j >= 0 ? s.slice(j) : "/";
    var q = s.indexOf("?"); if (q >= 0) s = s.slice(0, q);
    return s || "/";
  }
  function headerVal(headers, ln) { if (!headers) return null; for (var k in headers) { if (k.toLowerCase() === ln) return headers[k]; } return null; }
  function gasKeyFor(url) { for (var i = 0; i < GAS_ENDPOINTS.length; i++) { if (String(url).indexOf(GAS_ENDPOINTS[i].match) >= 0) return GAS_ENDPOINTS[i].key; } return null; }
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isNaN(n) ? v : n; }
  function parseGasBody(key, bodyStr) {
    var o; try { o = JSON.parse(bodyStr); } catch (e) { return null; }
    var first = Array.isArray(o) ? o[0] : o;
    if (!first || typeof first !== "object") return null;
    var out = {};
    if (key === "archive") { out.balance = num(first.f_jval); out.price = num(first.price); out.meterBase = num(first.f_tablebase); }
    else if (key === "metergas") { out.totalgas = num(first.totalgas); out.sumgas = num(first.sumgas); out.totalamount = num(first.totalamount); out.sumamount = num(first.sumamount); out.returngas = num(first.returngas); }
    else if (key === "sales") {
      if (!Array.isArray(o) || !o.length) return null;
      out.last_time = first.operate_time; out.last_money = num(first.money); out.last_gas = num(first.sellgas_gas); out.surplus_gas = num(first.f_surplus_gas); out.sales_page_count = o.length;
    }
    else if (key === "sales_summary") { out.sales_total_money = num(first.money); out.sales_total_gas = num(first.sellgas_gas); out.sales_count = num(first.n); }
    else if (key === "compare") {
      if (!Array.isArray(o)) return null;
      var pts = [], tot = 0;
      o.forEach(function (r) { var v = Number(r.data) || 0; tot += v; pts.push({ d: r.dates, v: r.data, lv: r.lastdata }); });
      out.compare_points = pts.slice(-14); out.compare_total = Math.round(tot * 100) / 100;
    }
    return out;
  }
  function serveHtml(html) { $done({ response: { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html } }); }
  function serveText(t) { $done({ response: { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: t } }); }
  function setupPage(msg) {
    var wt = loadJ(K_WTOKEN), rl = loadJ("wg_relay") || {}, hav = loadJ("wg_ha") || {};
    function st(ok) { return ok ? "已设置" : "未设置"; }
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>自来水采集设置</title></head><body style='font-family:-apple-system;padding:20px'>" +
      "<h3>自来水采集设置</h3><p>以下三项只保存在本机 Surge 存储中,不会上传。已设置的项留空即保持不变。</p>" +
      (msg ? "<p style='color:#0a7d2c'>" + msg + "</p>" : "") +
      "<form method='POST' action='https://example.com/wg-setup'>" +
      "<p>1. ntAuth 令牌(" + st(!!(wt && wt.value)) + "):<br><textarea name='token' rows='4' style='width:100%;font-size:13px' placeholder='从 Reqable 复制的 ntAuth 值'></textarea></p>" +
      "<p>2. 中继地址(" + st(!!rl.url) + "):<br><input name='relay_url' style='width:100%;font-size:14px' placeholder='http://192.168.x.x:18765' value='" + (rl.url || "") + "'></p>" +
      "<p>3. 中继密钥(" + st(!!rl.secret) + "):<br><input name='relay_secret' style='width:100%;font-size:14px' placeholder='中继密钥'></p>" +
      "<p>4. Home Assistant 地址(" + st(!!hav.url) + "):<br><input name='ha_url' style='width:100%;font-size:14px' placeholder='http://192.168.77.13' value='" + (hav.url || "") + "'></p>" +
      "<p>5. HA 长效令牌(" + st(!!hav.token) + "):<br><textarea name='ha_token' rows='3' style='width:100%;font-size:13px' placeholder='HA 个人资料-安全-长期访问令牌'></textarea></p>" +
      "<button type='submit' style='font-size:17px;padding:8px 22px'>保存</button></form></body></html>";
  }
  function formField(body, name) {
    var m = new RegExp("(?:^|&)" + name + "=([^&]*)").exec(body || "");
    if (!m) return "";
    try { return decodeURIComponent(m[1].replace(/\+/g, " ")).replace(/^\s+|\s+$/g, ""); } catch (e) { return ""; }
  }
  function ageStr(ts) { if (!ts) return "无"; var s = now() - ts; if (s < 3600) return Math.floor(s / 60) + "分钟前"; if (s < 86400) return Math.floor(s / 3600) + "小时前"; return Math.floor(s / 86400) + "天前"; }
  function buildReport() {
    var L = [];
    var g = loadJ(K_GAS), ck = loadJ(K_COOKIE), tpl = loadJ(K_TPL) || {};
    L.push("=== 水电气正式版核对报告 v1.8 ===");
    L.push("[燃气] 会话: " + (ck ? "已捕获(" + ageStr(ck.ts) + ")" : "未捕获,请打开一次燃气小程序"));
    L.push("已录制模板: " + (Object.keys(tpl).join(", ") || "无"));
    if (g) {
      L.push("数据时间: " + ageStr(g.ts) + " 来源: " + (g.src || "?"));
      if (g.balance !== undefined) L.push("账户余额: " + g.balance + " 元  气价: " + g.price);
      if (g.totalgas !== undefined) L.push("累计购气: " + g.totalgas + " 方  累计金额: " + g.totalamount + " 元");
      if (g.compare_total !== undefined && g.totalgas !== undefined) L.push("累计用气: " + g.compare_total + " 方  剩余气量(计算): " + (Math.round((g.totalgas - g.compare_total) * 100) / 100) + " 方");
      if (g.last_time) L.push("最近购气: " + g.last_time + " " + g.last_money + "元/" + g.last_gas + "方  剩余气量字段: " + (g.surplus_gas === null || g.surplus_gas === undefined ? "空(该公司未回填)" : g.surplus_gas));
      if (g.sales_count !== undefined) L.push("购气汇总: 共" + g.sales_count + "次, " + g.sales_total_money + "元/" + g.sales_total_gas + "方");
      if (g.compare_total !== undefined && g.totalgas === undefined) L.push("累计用气: " + g.compare_total + " 方");
    } else L.push("暂无燃气数据。");
    var gst = loadJ("wg_gas_status");
    if (gst) L.push("定时采集: 最近运行 " + ageStr(gst.lastRun) + " 成功项 " + (gst.okKeys || 0) + " 失败 " + (gst.failures || 0) + (gst.note ? " (" + gst.note + ")" : ""));
    var wt = loadJ(K_WTOKEN), w = loadJ(K_WATER), ws = loadJ(K_WSTATUS);
    L.push("");
    L.push("[自来水] 令牌: " + (wt ? "已设置(保存于 " + ageStr(wt.ts) + ",最近刷新 " + ageStr(wt.updated) + ")" : "未设置,请打开 example.com/wg-setup"));
    var rl3 = loadJ("wg_relay") || {};
    L.push("中继: " + (rl3.url ? "已设置 " + rl3.url : "未设置(请打开 example.com/wg-setup 补填中继地址与密钥)"));
    if (ws) {
      L.push("采集状态: 最近运行 " + ageStr(ws.lastRun) + " 阶段 " + (ws.stage || "?") + " 最近成功 " + ageStr(ws.lastOk) + " 构建 " + (ws.build || "旧版"));
      if (ws.stages) L.push("中继各步状态: " + JSON.stringify(ws.stages));
      if (ws.lastError) L.push("错误: " + ws.lastError);
    }
    if (w) {
      L.push("数据时间: " + ageStr(w.ts));
      L.push("用户列表 balanceFee: " + w.balanceFee + "  unBillMoney: " + w.unBillMoney + "  waterVolume: " + w.waterVolume_list + "  chargeAmount: " + w.chargeAmount_list);
      L.push("欠费接口 chargeAmount: " + w.arrears_amount);
      L.push("本月: 用水 " + w.monthVolume + "  arreFee: " + w.arreFee + "  lateFee: " + w.lateFee + "  preStoreFee: " + w.preStoreFee + "  paid: " + w.paid);
    } else L.push("暂无自来水数据。");
    var ha3 = loadJ("wg_ha") || {}, hast = loadJ("wg_ha_status") || {};
    L.push("");
    L.push("[Home Assistant] " + (ha3.url ? ha3.url : "未设置") + " 令牌: " + (ha3.token ? "已设置" : "未设置"));
    ["gas", "water"].forEach(function (src) {
      var s = hast[src];
      if (s) L.push("HA推送(" + src + "): " + ageStr(s.ts) + (s.skip ? " 跳过(" + s.skip + ")" : " 成功 " + (s.ok || 0) + " 失败 " + (s.fail || 0) + (s.http ? " HTTP " + s.http : "")));
    });
    return L.join("\n");
  }

  var url = ($request && $request.url) || "";
  var host = hostOf(url);

  if (host === REPORT_HOST) {
    var p = pathOf(url);
    if (p.indexOf("/wg-setup") === 0) {
      if ($request.method === "POST") {
        var body = String($request.body || "");
        var token = formField(body, "token");
        var rurl = formField(body, "relay_url");
        var rsec = formField(body, "relay_secret");
        var saved = [];
        if (token.length >= 20) { var prevT = loadJ(K_WTOKEN) || {}; saveJ(K_WTOKEN, { value: token, ts: now(), updated: prevT.updated || 0 }); saved.push("令牌"); }
        var rl2 = loadJ("wg_relay") || {};
        if (rurl.indexOf("http") === 0) { rl2.url = rurl.replace(/\/+$/, ""); saved.push("中继地址"); }
        if (rsec.length >= 8) { rl2.secret = rsec; saved.push("中继密钥"); }
        if (rl2.url || rl2.secret) saveJ("wg_relay", rl2);
        var hUrl = formField(body, "ha_url"), hTok = formField(body, "ha_token");
        var ha2 = loadJ("wg_ha") || {};
        if (hUrl.indexOf("http") === 0) { ha2.url = hUrl.replace(/\/+$/, ""); saved.push("HA地址"); }
        if (hTok.length >= 20) { ha2.token = hTok; saved.push("HA令牌"); }
        if (ha2.url || ha2.token) saveJ("wg_ha", ha2);
        if (saved.length) serveHtml(setupPage("已保存: " + saved.join("、") + "。可以运行一次 WG-Water-Cron 验证。"));
        else serveHtml(setupPage("没有可保存的内容(令牌太短或字段为空),请重试。"));
      } else serveHtml(setupPage(""));
      return;
    }
    if (p.indexOf("/wg-report") === 0) { serveText(buildReport()); return; }
    $done({}); return;
  }

  if (host.indexOf("catrq.com") < 0) { $done({}); return; }

  if (typeof $response === "undefined") {
    var rh = $request.headers || {};
    var ck2 = headerVal(rh, "cookie");
    if (ck2) saveJ(K_COOKIE, { value: ck2, ts: now() });
    var key = gasKeyFor(url);
    if (key && $request.method === "POST") {
      var tplAll = loadJ(K_TPL) || {};
      tplAll[key] = { url: url, method: "POST", body: String($request.body || ""), ctype: headerVal(rh, "content-type") || "", referer: headerVal(rh, "referer") || "", ua: headerVal(rh, "user-agent") || "", ts: now() };
      saveJ(K_TPL, tplAll);
    }
    $done({}); return;
  }

  var key2 = gasKeyFor(url);
  if (key2 && typeof $response.body === "string" && $response.body) {
    var parsed = parseGasBody(key2, $response.body);
    if (parsed) {
      var gdata = loadJ(K_GAS) || {};
      for (var f in parsed) gdata[f] = parsed[f];
      gdata.ts = now(); gdata.src = "live";
      saveJ(K_GAS, gdata);
    }
  }
  $done({});
})();
