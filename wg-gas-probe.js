// 水电气正式版 - 燃气会话保活探针 + HA 状态刷新
// 每 30 分钟: (1) 用已录制模板发一个最小真实请求, 只记录会话存活/失效的时间结构, 不保存任何业务数据值;
//           (2) 把手机本地缓存的上次采集结果(燃气+自来水+两报警)重推一遍 HA, 使 HA 重启后实体自动恢复。
(function () {
  var K_COOKIE = "wg_gas_cookie", K_TPL = "wg_gas_tpl", K_PROBE = "wg_probe", K_GAS = "wg_gas_data", K_WATER = "wg_water_data", K_HA = "wg_ha";
  function now() { return Math.floor(Date.now() / 1000); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(k, o) { try { $persistentStore.write(JSON.stringify(o), k); } catch (e) {} }
  function fpOf(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = ((h * 31) + s.charCodeAt(i)) | 0; } return "h" + (h >>> 0).toString(16) + "_" + s.length; }
  function haNum(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isNaN(n) ? null : n; }

  function buildItems() {
    var items = [];
    var g = loadJ(K_GAS);
    if (g) {
      var remaining = (haNum(g.totalgas) !== null && haNum(g.compare_total) !== null) ? Math.round((g.totalgas - g.compare_total) * 100) / 100 : null;
      items.push({ entity: "sensor.gas_balance", state: haNum(g.balance), attrs: { friendly_name: "燃气账户余额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } });
      items.push({ entity: "sensor.gas_total_purchased", state: haNum(g.totalgas), attrs: { friendly_name: "累计购气量", unit_of_measurement: "m³", state_class: "total_increasing" } });
      items.push({ entity: "sensor.gas_total_used", state: haNum(g.compare_total), attrs: { friendly_name: "累计用气量", unit_of_measurement: "m³", state_class: "total_increasing" } });
      items.push({ entity: "sensor.gas_remaining", state: remaining, attrs: { friendly_name: "剩余气量", unit_of_measurement: "m³", state_class: "measurement" } });
      items.push({ entity: "sensor.gas_total_amount", state: haNum(g.totalamount), attrs: { friendly_name: "累计购气金额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } });
      items.push({ entity: "sensor.gas_price", state: haNum(g.price), attrs: { friendly_name: "燃气单价", unit_of_measurement: "CNY/m³", state_class: "measurement" } });
      items.push({ entity: "sensor.gas_last_purchase", state: haNum(g.last_money), attrs: { friendly_name: "最近一次购气", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement", purchase_time: g.last_time || "", gas_m3: haNum(g.last_gas) } });
      items.push({ entity: "binary_sensor.gas_low", state: remaining === null ? null : (remaining < 10 ? "on" : "off"), attrs: { friendly_name: "燃气不足", device_class: "moisture" } });
    }
    var w = loadJ(K_WATER);
    if (w) {
      var wBal = haNum(w.arrears_amount);
      items.push({ entity: "sensor.water_balance", state: wBal, attrs: { friendly_name: "自来水余额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } });
      items.push({ entity: "sensor.water_month_usage", state: haNum(w.monthVolume), attrs: { friendly_name: "本月用水", unit_of_measurement: "m³", state_class: "total_increasing" } });
      items.push({ entity: "sensor.water_month_bill", state: haNum(w.arreFee), attrs: { friendly_name: "本月水费待缴", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } });
      items.push({ entity: "sensor.water_unbilled", state: haNum(w.unBillMoney), attrs: { friendly_name: "自来水未出账", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } });
      items.push({ entity: "binary_sensor.water_low", state: wBal === null ? null : (wBal < 20 ? "on" : "off"), attrs: { friendly_name: "自来水余额不足", device_class: "moisture" } });
    }
    return items.filter(function (it) { return it.state !== null && it.state !== undefined; });
  }

  function repush(pb, doneFn) {
    var ha = loadJ(K_HA);
    var items = buildItems();
    if (!ha || !ha.url || !ha.token || !items.length) { doneFn(); return; }
    var base = String(ha.url).replace(/\/+$/, "");
    var i = 0, okc = 0;
    (function next() {
      if (i >= items.length) { pb.repushTs = now(); pb.repushOk = okc; saveJ(K_PROBE, pb); doneFn(); return; }
      var it = items[i++];
      $httpClient.post({ url: base + "/api/states/" + it.entity, headers: { "Authorization": "Bearer " + ha.token, "Content-Type": "application/json" }, body: JSON.stringify({ state: it.state, attributes: it.attrs }), timeout: 15 },
        function (err, resp) { if (!err && resp && (resp.status === 200 || resp.status === 201)) okc++; next(); });
    })();
  }

  var ck = loadJ(K_COOKIE), tpl = loadJ(K_TPL) || {};
  var pb = loadJ(K_PROBE) || { checks: 0, netErr: 0 };
  pb.lastCheck = now();

  if (!ck || !ck.value) { pb.state = "no_session"; saveJ(K_PROBE, pb); repush(pb, function () { $done(); }); return; }
  var fp = fpOf(ck.value);
  if (pb.fp !== fp) { pb.fp = fp; pb.bornAt = ck.ts || now(); pb.state = "unknown"; pb.deadAt = null; }
  var key = ["archive", "metergas", "sales", "compare", "sales_summary"].filter(function (k) { return tpl[k]; })[0];
  if (!key) { pb.state = "no_tpl"; saveJ(K_PROBE, pb); repush(pb, function () { $done(); }); return; }
  var t = tpl[key];
  var headers = { "Content-Type": t.ctype || "application/x-www-form-urlencoded", "Cookie": ck.value, "Referer": t.referer || "", "User-Agent": t.ua || "" };
  $httpClient.post({ url: t.url, headers: headers, body: t.body, timeout: 20 }, function (error, response, data) {
    if (error) { pb.netErr = (pb.netErr || 0) + 1; saveJ(K_PROBE, pb); repush(pb, function () { $done(); }); return; }
    var alive = false;
    try {
      var o = JSON.parse(data);
      if (Array.isArray(o)) alive = o.length > 0;
      else if (o && typeof o === "object") alive = Object.keys(o).length > 0;
    } catch (e) { alive = false; }
    if (response && response.status && response.status !== 200) alive = false;
    pb.checks = (pb.checks || 0) + 1;
    if (alive) {
      pb.state = "alive"; pb.lastOk = now(); pb.deadAt = null;
    } else {
      if (pb.state !== "dead") {
        pb.deadAt = now();
        pb.lastDeadAt = now();
        pb.lastLifeH = pb.bornAt ? Math.round((now() - pb.bornAt) / 360) / 10 : null;
      }
      pb.state = "dead";
    }
    saveJ(K_PROBE, pb);
    repush(pb, function () { $done(); });
  });
})();
