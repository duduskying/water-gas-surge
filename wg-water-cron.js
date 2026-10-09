// 水电气正式版 - 自来水定时采集(令牌自续期)
// 流程: 读本地令牌 -> refresh 换新令牌(返回 resultData.token) -> 拉用户列表/欠费接口/本月账单 -> 存本地
// 不做在途拦截, 不影响小程序日常使用。
(function () {
  var BASE = "https://www.xazls.com/wpg/main/client";
  var GW = "https://example.com/wgfetch"; // 经核心脚本改写, 由 Surge 代理核心代发(脚本引擎直连会被对方网关拒绝握手)
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
      var st = response && response.status;
      if (error) { cb(null, String(error), st, ""); return; }
      var j = null;
      try { j = JSON.parse(data); } catch (e) {}
      var diag = "";
      if (!j) {
        var rh = (response && response.headers) || {};
        var srv = rh.Server || rh.server || "?";
        diag = "srv=" + srv + " body=" + String(data || "").replace(/\s+/g, " ").slice(0, 140);
      }
      cb(j, j ? null : "响应非JSON(状态 " + st + ",长度 " + (data ? data.length : 0) + ")", st, diag);
    });
  }
  function setStatus(patch) {
    var st = loadJ(K_WSTATUS) || {};
    for (var k in patch) st[k] = patch[k];
    st.ts = now();
    saveJ(K_WSTATUS, st);
  }
  function ok(j) { return j && String(j.errorCode) === "200"; }

  var tokObj = loadJ(K_WTOKEN);
  if (!tokObj || !tokObj.value) {
    notifyOnce("water_no_token", "自来水采集待初始化", "请用 Safari 打开 example.com/wg-setup 粘贴一次令牌, 之后将自动续期采集。");
    $done(); return;
  }
  var oldToken = tokObj.value;
  setStatus({ lastRun: now(), stage: "start", lastError: "" });
  req("GET", GW + "/refresh", oldToken, null, function (rj, rerr, rst, rdiag) {
    var candidate = oldToken, refreshed = false;
    if (ok(rj) && rj.resultData && rj.resultData.token) { candidate = rj.resultData.token; refreshed = candidate !== oldToken; }
    setStatus({ stage: "refresh_done", refreshHttp: rst || 0, refreshCode: rj ? String(rj.errorCode) : "", refreshHasToken: !!(rj && rj.resultData && rj.resultData.token), refreshErr: rerr || "", refreshDiag: rdiag || "" });
    // 网关注入的是存储中的令牌: 先把新令牌落盘, 后续调用才真正用上它; 失败回滚旧令牌再重试
    if (candidate !== oldToken) saveJ(K_WTOKEN, { value: candidate, ts: tokObj.ts || now(), updated: now() });
    fetchAll(candidate, false);
    function fetchAll(token, isRetry) {
      setStatus({ stage: "userlist" });
      req("GET", GW + "/userlist", token, null, function (uj, uerr, ust, udiag) {
        setStatus({ stage: "userlist_done", userHttp: ust || 0, userCode: uj ? String(uj.errorCode) : "", userErr: uerr || "", userDiag: udiag || "" });
        if (!ok(uj)) {
          if (!isRetry && candidate !== oldToken) { saveJ(K_WTOKEN, { value: oldToken, ts: tokObj.ts || now(), updated: tokObj.updated || 0 }); fetchAll(oldToken, true); return; }
          setStatus({ stage: "failed", lastOk: 0, lastError: "用户列表失败: " + (uerr || (uj && uj.errorMsg) || "?") });
          notifyOnce("water_auth_fail", "自来水令牌可能已失效", "自动采集失败。请在 Reqable 中复制新的 ntAuth, 打开 example.com/wg-setup 重新粘贴。");
          $done(); return;
        }
        if (refreshed && token === candidate) { tokObj.value = candidate; tokObj.updated = now(); saveJ(K_WTOKEN, tokObj); }
        var rows = uj.resultData || [];
        var row = Array.isArray(rows) ? rows[0] : null;
        if (!row) { setStatus({ stage: "failed", lastOk: 0, lastError: "用户列表为空" }); $done(); return; }
        var clientCode = row.clientCode;
        if (clientCode) saveJ(K_WCLIENT, { code: clientCode });
        var data = { ts: now(), balanceFee: row.balanceFee, unBillMoney: row.unBillMoney, waterVolume_list: row.waterVolume, chargeAmount_list: row.chargeAmount };
        req("POST", GW + "/arrears", token, JSON.stringify([clientCode]), function (aj) {
          if (ok(aj) && Array.isArray(aj.resultData) && aj.resultData[0]) data.arrears_amount = aj.resultData[0].chargeAmount;
          req("GET", GW + "/meterlist?mrMonth=" + yyyymm(), token, null, function (mj) {
            if (ok(mj) && Array.isArray(mj.resultData) && mj.resultData[0]) {
              var mrow = mj.resultData[0];
              data.monthVolume = mrow.waterVolume; data.arreFee = mrow.arreFee; data.lateFee = mrow.lateFee; data.preStoreFee = mrow.preStoreFee; data.paid = mrow.paid;
            }
            saveJ(K_WATER, data);
            setStatus({ stage: "done", lastOk: now(), lastError: "" });
            $done();
          });
        });
      });
    }
  });
})();
