// 水电气正式版 - 燃气定时重放采集
// 用手机本地录制的请求模板 + 最新会话, 每天重放一次并解析; 无模板/会话失效时节流通知。
(function () {
  var K_COOKIE = "wg_gas_cookie", K_TPL = "wg_gas_tpl", K_GAS = "wg_gas_data", K_NOTIFY = "wg_notify", K_GSTATUS = "wg_gas_status";
  function now() { return Math.floor(Date.now() / 1000); }
  function dayStr() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(k, o) { try { $persistentStore.write(JSON.stringify(o), k); } catch (e) {} }
  function notifyOnce(kind, title, body) {
    var n = loadJ(K_NOTIFY) || {};
    var key = kind + "_" + dayStr();
    if (n[key]) return;
    n[key] = 1; saveJ(K_NOTIFY, n);
    $notification.post(title, "", body);
  }
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

  var ck = loadJ(K_COOKIE), tpl = loadJ(K_TPL) || {};
  var keys = ["archive", "metergas", "sales", "sales_summary", "compare"].filter(function (k) { return tpl[k]; });
  if (!ck || !keys.length) {
    saveJ(K_GSTATUS, { lastRun: now(), okKeys: 0, failures: 0, note: "no_tpl_or_cookie" });
    notifyOnce("gas_no_tpl", "燃气采集待初始化", "请打开一次燃气小程序并点进购气/用量页面, 之后将自动每日采集。");
    $done(); return;
  }
  var results = {}, failures = 0, idx = 0;
  function step() {
    if (idx >= keys.length) {
      var gdata = loadJ(K_GAS) || {};
      for (var f in results) gdata[f] = results[f];
      if (Object.keys(results).length) { gdata.ts = now(); gdata.src = "cron"; saveJ(K_GAS, gdata); }
      saveJ(K_GSTATUS, { lastRun: now(), okKeys: keys.length - failures, failures: failures, note: "" });
      if (failures === keys.length) notifyOnce("gas_expired", "燃气会话可能已过期", "今日自动采集全部失败, 请打开一次燃气小程序即可恢复。");
      $done(); return;
    }
    var key = keys[idx++], t = tpl[key];
    var headers = { "Content-Type": t.ctype || "application/x-www-form-urlencoded", "Cookie": ck.value, "Referer": t.referer || "", "User-Agent": t.ua || "" };
    $httpClient.post({ url: t.url, headers: headers, body: t.body }, function (error, response, data) {
      if (!error && data) {
        var parsed = parseGasBody(key, data);
        if (parsed) { for (var f2 in parsed) results[f2] = parsed[f2]; }
        else failures++;
      } else failures++;
      step();
    });
  }
  step();
})();
