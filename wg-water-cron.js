// 水电气正式版 - 自来水定时采集(Mac 中继版)
// 手机 -> 家庭局域网内的 Mac 中继 -> 自来水服务器(脚本引擎直连会被对方网关拒绝, 故绕行)
// 中继地址与密钥在 example.com/wg-setup 一次填入, 只存手机本地。
(function () {
  var K_WTOKEN = "wg_water_token", K_WATER = "wg_water_data", K_WSTATUS = "wg_water_status", K_RELAY = "wg_relay", K_NOTIFY = "wg_notify";
  function now() { return Math.floor(Date.now() / 1000); }
  function dayStr() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(k, o) { try { $persistentStore.write(JSON.stringify(o), k); } catch (e) {} }
  function setStatus(patch) { var st = loadJ(K_WSTATUS) || {}; for (var k in patch) st[k] = patch[k]; st.ts = now(); saveJ(K_WSTATUS, st); }
  function notifyOnce(kind, title, body) {
    var n = loadJ(K_NOTIFY) || {}; var key = kind + "_" + dayStr();
    if (n[key]) return; n[key] = 1; saveJ(K_NOTIFY, n);
    $notification.post(title, "", body);
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
  var relay = loadJ(K_RELAY);
  var tokObj = loadJ(K_WTOKEN);
  setStatus({ lastRun: now(), build: "1.5" });
  if (!tokObj || !tokObj.value) {
    setStatus({ stage: "no_token" });
    notifyOnce("water_no_token", "自来水采集待初始化", "请用 Safari 打开 example.com/wg-setup 填写令牌与中继信息。");
    $done(); return;
  }
  if (!relay || !relay.url || !relay.secret) {
    setStatus({ stage: "no_relay" });
    notifyOnce("water_no_relay", "自来水采集待初始化", "请用 Safari 打开 example.com/wg-setup 补填中继地址与中继密钥。");
    $done(); return;
  }
  var base = String(relay.url).replace(/\/+$/, "");
  $httpClient.post({
    url: base + "/collect",
    headers: { "Content-Type": "application/json", "X-Relay-Secret": relay.secret },
    body: JSON.stringify({ token: tokObj.value }),
    timeout: 30
  }, function (error, response, data) {
    if (error) { setStatus({ stage: "relay_unreachable", lastError: String(error) }); notifyOnce("water_relay_down", "💧 自来水未更新", "今日未连上家中中继, 数据未更新。"); $done(); return; }
    var j = null;
    try { j = JSON.parse(data); } catch (e) {}
    if (!j) { setStatus({ stage: "relay_bad_response", lastError: "HTTP " + (response && response.status) }); $done(); return; }
    if (j.ok) {
      if (j.token && j.token !== tokObj.value) saveJ(K_WTOKEN, { value: j.token, ts: tokObj.ts || now(), updated: now() });
      var d = j.data || {}; d.ts = now();
      saveJ(K_WATER, d);
      setStatus({ stage: "done", lastOk: now(), lastError: "", stages: j.stages || {} });
      var wBal = haNum(d.arrears_amount);
      var wParts = [];
      if (wBal !== null) wParts.push("余额 " + wBal + " 元");
      if (haNum(d.monthVolume) !== null) wParts.push("本月用水 " + d.monthVolume + " m³");
      if (haNum(d.arreFee) !== null) wParts.push("本月待缴 " + d.arreFee + " 元");
      if (wBal !== null && wBal < 20) $notification.post("⚠️ 自来水余额不足", "", "余额仅剩 " + wBal + " 元 · 本月用水 " + (d.monthVolume !== null && d.monthVolume !== undefined ? d.monthVolume : "?") + " m³, 请及时充值");
      else $notification.post("💧 自来水日报", "", wParts.join(" · ") || "数据已更新");
      var items = [
        { entity: "sensor.water_balance", state: haNum(d.arrears_amount), attrs: { friendly_name: "自来水余额", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } },
        { entity: "sensor.water_month_usage", state: haNum(d.monthVolume), attrs: { friendly_name: "本月用水", unit_of_measurement: "m³", state_class: "total_increasing" } },
        { entity: "sensor.water_month_bill", state: haNum(d.arreFee), attrs: { friendly_name: "本月水费待缴", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } },
        { entity: "sensor.water_unbilled", state: haNum(d.unBillMoney), attrs: { friendly_name: "自来水未出账", unit_of_measurement: "CNY", device_class: "monetary", state_class: "measurement" } }
      ];
      haPush(items, "water", function () { $done(); });
    } else {
      setStatus({ stage: j.stage || "failed", lastError: j.errorMsg || "", stages: j.stages || {} });
      if (j.stage === "userlist") notifyOnce("water_auth_fail", "自来水令牌可能已失效", "中继返回令牌无效。请在 Reqable 复制新的 ntAuth, 打开 example.com/wg-setup 重新填写。");
      if (j.stage === "auth") notifyOnce("water_relay_auth", "自来水中继密钥不匹配", "请打开 example.com/wg-setup 核对中继密钥。");
      $done();
    }
  });
})();
