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


  var K_HA = "wg_ha", K_HAST = "wg_ha_status";
  function setHaStatus(src, obj) { var all = loadJ(K_HAST) || {}; all[src] = obj; saveJ(K_HAST, all); }
  function haNum(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isNaN(n) ? null : n; }
  function haPush(items, src, doneFn) {
    var ha = loadJ(K_HA);
    if (!ha || !ha.url || !ha.token) { setHaStatus(src, { ts: now(), skip: "no_ha" }); doneFn(); return; }
    var base = String(ha.url).replace(/\/+$/, "");
    var i = 0, okc = 0, failc = 0, lastHttp = 0;
    (function next() {
      if (i >= items.length) { setHaStatus(src, { ts: now(), ok: okc, fail: failc, http: lastHttp }); doneFn(); return; }
      var it = items[i++];
      if (it.state === null || it.state === undefined) { next(); return; }
      $httpClient.post({ url: base + "/api/states/" + it.entity, headers: { "Authorization": "Bearer " + ha.token, "Content-Type": "application/json" }, body: JSON.stringify({ state: it.state, attributes: it.attrs }), timeout: 15 },
        function (err, resp) { if (!err && resp && (resp.status === 200 || resp.status === 201)) okc++; else { failc++; lastHttp = resp ? resp.status : 0; } next(); });
    })();
  }

  function widenCompareBody(body) {
    try {
      var m = /(^|&)data=([^&]*)/.exec(body || "");
      if (!m) return body;
      var outer = JSON.parse(decodeURIComponent(m[2]));
      var holder = (outer && typeof outer.param === "object" && outer.param) || outer;
      var re = /^\d{4}-\d{2}-\d{2}$/;
      if (holder && re.test(holder.startDate || "") && re.test(holder.endDate || "")) {
        var d = new Date(Date.now() + 8 * 3600 * 1000);
        var mm = ("0" + (d.getUTCMonth() + 1)).slice(-2), dd = ("0" + d.getUTCDate()).slice(-2);
        holder.startDate = "2020-01-01";
        holder.endDate = d.getUTCFullYear() + "-" + mm + "-" + dd;
        return body.replace(m[0], m[1] + "data=" + encodeURIComponent(JSON.stringify(outer)));
      }
    } catch (e) {}
    return body;
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
      if (Object.keys(results).length) {
        var remaining = (haNum(gdata.totalgas) !== null && haNum(gdata.compare_total) !== null) ? Math.round((gdata.totalgas - gdata.compare_total) * 100) / 100 : null;
        var gBal = haNum(gdata.balance);
        var gParts = [];
        if (remaining !== null) gParts.push("剩余 " + remaining + " 方");
        if (gBal !== null) gParts.push("余额 " + gBal + " 元");
        if (haNum(gdata.compare_total) !== null) gParts.push("累计用气 " + gdata.compare_total + " 方");
        if (remaining !== null && remaining < 10) $notification.post("⚠️ 燃气剩余不足", "", "仅剩 " + remaining + " 方 · 余额 " + (gBal !== null ? gBal : "?") + " 元, 请及时购气");
        else $notification.post("⛽ 燃气日报", "", gParts.join(" · ") || "数据已更新");
        var items = [
          { entity: "sensor.gas_balance", state: haNum(gdata.balance), attrs: { friendly_name: "燃气账户余额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } },
          { entity: "sensor.gas_total_purchased", state: haNum(gdata.totalgas), attrs: { friendly_name: "累计购气量", unit_of_measurement: "m³", state_class: "total_increasing" } },
          { entity: "sensor.gas_total_used", state: haNum(gdata.compare_total), attrs: { friendly_name: "累计用气量", unit_of_measurement: "m³", state_class: "total_increasing" } },
          { entity: "sensor.gas_remaining", state: remaining, attrs: { friendly_name: "剩余气量", unit_of_measurement: "m³", state_class: "measurement" } },
          { entity: "sensor.gas_total_amount", state: haNum(gdata.totalamount), attrs: { friendly_name: "累计购气金额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } },
          { entity: "sensor.gas_price", state: haNum(gdata.price), attrs: { friendly_name: "燃气单价", unit_of_measurement: "CNY/m³", state_class: "measurement" } },
          { entity: "sensor.gas_last_purchase", state: haNum(gdata.last_money), attrs: { friendly_name: "最近一次购气", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement", purchase_time: gdata.last_time || "", gas_m3: haNum(gdata.last_gas) } },
          { entity: "binary_sensor.gas_low", state: remaining === null ? null : (remaining < 10 ? "on" : "off"), attrs: { friendly_name: "燃气不足", device_class: "moisture" } }
        ];
        haPush(items, "gas", function () { $done(); });
      } else $done();
      return;
    }
    var key = keys[idx++], t = tpl[key];
    var headers = { "Content-Type": t.ctype || "application/x-www-form-urlencoded", "Cookie": ck.value, "Referer": t.referer || "", "User-Agent": t.ua || "" };
    $httpClient.post({ url: t.url, headers: headers, body: key === "compare" ? widenCompareBody(t.body) : t.body }, function (error, response, data) {
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
