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
    if (key === "archive") { out.reading = num(first.f_jval); out.price = num(first.price); out.meterBase = num(first.f_tablebase); }
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
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>自来水令牌设置</title></head><body style='font-family:-apple-system;padding:20px'>" +
      "<h3>自来水令牌设置</h3><p>把从 Reqable 里复制的 ntAuth 值粘贴到下面,提交后只保存在本机 Surge 存储中,不会上传。</p>" +
      (msg ? "<p style='color:#0a7d2c'>" + msg + "</p>" : "") +
      "<form method='POST' action='https://example.com/wg-setup'><textarea name='token' rows='5' style='width:100%;font-size:13px' placeholder='粘贴 ntAuth 值'></textarea><br><br><button type='submit' style='font-size:17px;padding:8px 22px'>保存</button></form></body></html>";
  }
  function ageStr(ts) { if (!ts) return "无"; var s = now() - ts; if (s < 3600) return Math.floor(s / 60) + "分钟前"; if (s < 86400) return Math.floor(s / 3600) + "小时前"; return Math.floor(s / 86400) + "天前"; }
  function buildReport() {
    var L = [];
    var g = loadJ(K_GAS), ck = loadJ(K_COOKIE), tpl = loadJ(K_TPL) || {};
    L.push("=== 水电气正式版核对报告 ===");
    L.push("[燃气] 会话: " + (ck ? "已捕获(" + ageStr(ck.ts) + ")" : "未捕获,请打开一次燃气小程序"));
    L.push("已录制模板: " + (Object.keys(tpl).join(", ") || "无"));
    if (g) {
      L.push("数据时间: " + ageStr(g.ts) + " 来源: " + (g.src || "?"));
      if (g.reading !== undefined) L.push("表读数 f_jval: " + g.reading + "  气价: " + g.price);
      if (g.totalgas !== undefined) L.push("累计用气 totalgas: " + g.totalgas + "  sumgas: " + g.sumgas + "  累计金额 totalamount: " + g.totalamount);
      if (g.last_time) L.push("最近购气: " + g.last_time + " " + g.last_money + "元/" + g.last_gas + "方  剩余气量字段: " + (g.surplus_gas === null || g.surplus_gas === undefined ? "空(该公司未回填)" : g.surplus_gas));
      if (g.sales_count !== undefined) L.push("购气汇总: 共" + g.sales_count + "次, " + g.sales_total_money + "元/" + g.sales_total_gas + "方");
      if (g.compare_total !== undefined) L.push("用量分析合计: " + g.compare_total + " (点数 " + (g.compare_points || []).length + ")");
    } else L.push("暂无燃气数据。");
    var gst = loadJ("wg_gas_status");
    if (gst) L.push("定时采集: 最近运行 " + ageStr(gst.lastRun) + " 成功项 " + (gst.okKeys || 0) + " 失败 " + (gst.failures || 0) + (gst.note ? " (" + gst.note + ")" : ""));
    var wt = loadJ(K_WTOKEN), w = loadJ(K_WATER), ws = loadJ(K_WSTATUS);
    L.push("");
    L.push("[自来水] 令牌: " + (wt ? "已设置(保存于 " + ageStr(wt.ts) + ",最近刷新 " + ageStr(wt.updated) + ")" : "未设置,请打开 example.com/wg-setup"));
    if (ws) {
      L.push("采集状态: 最近运行 " + ageStr(ws.lastRun) + " 阶段 " + (ws.stage || "?") + " 最近成功 " + ageStr(ws.lastOk));
      if (ws.refreshHttp !== undefined) L.push("刷新接口: HTTP " + ws.refreshHttp + " 业务码 " + (ws.refreshCode || "?") + " 返回新令牌 " + (ws.refreshHasToken ? "是" : "否") + (ws.refreshErr ? " 错误 " + ws.refreshErr : ""));
      if (ws.userHttp !== undefined) L.push("用户列表: HTTP " + ws.userHttp + " 业务码 " + (ws.userCode || "?") + (ws.userErr ? " 错误 " + ws.userErr : ""));
      if (ws.lastError) L.push("错误: " + ws.lastError);
    }
    if (w) {
      L.push("数据时间: " + ageStr(w.ts));
      L.push("用户列表 balanceFee: " + w.balanceFee + "  unBillMoney: " + w.unBillMoney + "  waterVolume: " + w.waterVolume_list + "  chargeAmount: " + w.chargeAmount_list);
      L.push("欠费接口 chargeAmount: " + w.arrears_amount);
      L.push("本月: 用水 " + w.monthVolume + "  arreFee: " + w.arreFee + "  lateFee: " + w.lateFee + "  preStoreFee: " + w.preStoreFee + "  paid: " + w.paid);
    } else L.push("暂无自来水数据。");
    return L.join("\n");
  }

  var url = ($request && $request.url) || "";
  var host = hostOf(url);

  if (host === REPORT_HOST) {
    var p = pathOf(url);
    if (p.indexOf("/wg-setup") === 0) {
      if ($request.method === "POST") {
        var body = String($request.body || "");
        var m = /(?:^|&)token=([^&]*)/.exec(body);
        var token = "";
        if (m) { try { token = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { token = m[1]; } }
        token = token.replace(/^\s+|\s+$/g, "");
        if (token.length >= 20) { saveJ(K_WTOKEN, { value: token, ts: now(), updated: 0 }); serveHtml(setupPage("已保存(长度 " + token.length + ")。可以运行一次 WG-Water-Cron 手动采集验证。")); }
        else serveHtml(setupPage("粘贴的内容太短,未保存,请重试。"));
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
