// 水电气正式版 - 自来水定时采集(令牌自续期)
// 流程: 读本地令牌 -> refresh 换新令牌(返回 resultData.token) -> 拉用户列表/欠费接口/本月账单 -> 存本地
// 不做在途拦截, 不影响小程序日常使用。
(function () {
  var BASE = "https://www.xazls.com/wpg/main/client";
  var APP_SEG = "wx67baba836a7b62bf";
  var K_WTOKEN = "wg_water_token", K_WATER = "wg_water_data", K_WSTATUS = "wg_water_status", K_WCLIENT = "wg_water_client", K_NOTIFY = "wg_notify";
  function now() { return Math.floor(Date.now() / 1000); }
  function cnDate() { return new Date(Date.now() + 8 * 3600 * 1000); }
  function dayStr() { var d = cnDate(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function yyyymm() { var d = cnDate(); var m = d.getUTCMonth() + 1; return d.getUTCFullYear() + "-" + (m < 10 ? "0" + m : m); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(k, o) { try { $persistentStore.write(JSON.stringify(o), k); } catch (e) {} }
  function notifyOnce(kind, title, body) {
    var n = loadJ(K_NOTIFY) || {}; var key = kind + "_" + dayStr();
    if (n[key]) return; n[key] = 1; saveJ(K_NOTIFY, n);
    $notification.post(title, "", body);
  }
  function req(method, url, token, body, cb) {
    var opts = { url: url, headers: { "ntAuth": token, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone) MicroMessenger" } };
    if (body !== null && body !== undefined) opts.body = body;
    var fn = method === "POST" ? $httpClient.post : $httpClient.get;
    fn(opts, function (error, response, data) {
      if (error) { cb(null, String(error)); return; }
      var j = null;
      try { j = JSON.parse(data); } catch (e) {}
      cb(j, j ? null : "响应非JSON(状态 " + (response && response.status) + ")");
    });
  }
  function ok(j) { return j && String(j.errorCode) === "200"; }

  var tokObj = loadJ(K_WTOKEN);
  if (!tokObj || !tokObj.value) {
    notifyOnce("water_no_token", "自来水采集待初始化", "请用 Safari 打开 example.com/wg-setup 粘贴一次令牌, 之后将自动续期采集。");
    $done(); return;
  }
  var oldToken = tokObj.value;
  req("GET", BASE + "/wx/" + APP_SEG + "/refresh", oldToken, null, function (rj, rerr) {
    var candidate = oldToken, refreshed = false;
    if (ok(rj) && rj.resultData && rj.resultData.token) { candidate = rj.resultData.token; refreshed = candidate !== oldToken; }
    fetchAll(candidate, false);
    function fetchAll(token, isRetry) {
      req("GET", BASE + "/bind/selectWaterUserListWithNoBill", token, null, function (uj, uerr) {
        if (!ok(uj)) {
          if (!isRetry && candidate !== oldToken) { fetchAll(oldToken, true); return; }
          saveJ(K_WSTATUS, { lastOk: 0, lastError: "用户列表失败: " + (uerr || (uj && uj.errorMsg) || "?"), ts: now() });
          notifyOnce("water_auth_fail", "自来水令牌可能已失效", "自动采集失败。请在 Reqable 中复制新的 ntAuth, 打开 example.com/wg-setup 重新粘贴。");
          $done(); return;
        }
        if (refreshed && token === candidate) { tokObj.value = candidate; tokObj.updated = now(); saveJ(K_WTOKEN, tokObj); }
        var rows = uj.resultData || [];
        var row = Array.isArray(rows) ? rows[0] : null;
        if (!row) { saveJ(K_WSTATUS, { lastOk: 0, lastError: "用户列表为空", ts: now() }); $done(); return; }
        var clientCode = row.clientCode;
        if (clientCode) saveJ(K_WCLIENT, { code: clientCode });
        var data = { ts: now(), balanceFee: row.balanceFee, unBillMoney: row.unBillMoney, waterVolume_list: row.waterVolume, chargeAmount_list: row.chargeAmount };
        req("POST", BASE + "/bind/queryArrearsByClientNo", token, JSON.stringify([clientCode]), function (aj) {
          if (ok(aj) && Array.isArray(aj.resultData) && aj.resultData[0]) data.arrears_amount = aj.resultData[0].chargeAmount;
          req("GET", BASE + "/remote/revenue/select/meterReadListNew?mrMonth=" + yyyymm(), token, null, function (mj) {
            if (ok(mj) && Array.isArray(mj.resultData) && mj.resultData[0]) {
              var mrow = mj.resultData[0];
              data.monthVolume = mrow.waterVolume; data.arreFee = mrow.arreFee; data.lateFee = mrow.lateFee; data.preStoreFee = mrow.preStoreFee; data.paid = mrow.paid;
            }
            saveJ(K_WATER, data);
            saveJ(K_WSTATUS, { lastOk: now(), lastError: "", ts: now() });
            $done();
          });
        });
      });
    }
  });
})();
