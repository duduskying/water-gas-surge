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
    if (error) { setStatus({ stage: "relay_unreachable", lastError: String(error) }); $done(); return; }
    var j = null;
    try { j = JSON.parse(data); } catch (e) {}
    if (!j) { setStatus({ stage: "relay_bad_response", lastError: "HTTP " + (response && response.status) }); $done(); return; }
    if (j.ok) {
      if (j.token && j.token !== tokObj.value) saveJ(K_WTOKEN, { value: j.token, ts: tokObj.ts || now(), updated: now() });
      var d = j.data || {}; d.ts = now();
      saveJ(K_WATER, d);
      setStatus({ stage: "done", lastOk: now(), lastError: "", stages: j.stages || {} });
    } else {
      setStatus({ stage: j.stage || "failed", lastError: j.errorMsg || "", stages: j.stages || {} });
      if (j.stage === "userlist") notifyOnce("water_auth_fail", "自来水令牌可能已失效", "中继返回令牌无效。请在 Reqable 复制新的 ntAuth, 打开 example.com/wg-setup 重新填写。");
      if (j.stage === "auth") notifyOnce("water_relay_auth", "自来水中继密钥不匹配", "请打开 example.com/wg-setup 核对中继密钥。");
    }
    $done();
  });
})();
