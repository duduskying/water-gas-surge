// 水电气正式版 - 燃气会话保活探针(诊断版)
// 每 30 分钟用已录制模板发一个最小真实请求, 只记录会话存活/失效的时间结构, 不解析、不保存任何业务数据值, 不发通知。
(function () {
  var K_COOKIE = "wg_gas_cookie", K_TPL = "wg_gas_tpl", K_PROBE = "wg_probe";
  function now() { return Math.floor(Date.now() / 1000); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveJ(k, o) { try { $persistentStore.write(JSON.stringify(o), k); } catch (e) {} }
  function fpOf(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = ((h * 31) + s.charCodeAt(i)) | 0; } return "h" + (h >>> 0).toString(16) + "_" + s.length; }

  var ck = loadJ(K_COOKIE), tpl = loadJ(K_TPL) || {};
  var pb = loadJ(K_PROBE) || { checks: 0, netErr: 0 };
  pb.lastCheck = now();

  if (!ck || !ck.value) { pb.state = "no_session"; saveJ(K_PROBE, pb); $done(); return; }
  var fp = fpOf(ck.value);
  if (pb.fp !== fp) { pb.fp = fp; pb.bornAt = ck.ts || now(); pb.state = "unknown"; pb.deadAt = null; }
  var key = ["archive", "metergas", "sales", "compare", "sales_summary"].filter(function (k) { return tpl[k]; })[0];
  if (!key) { pb.state = "no_tpl"; saveJ(K_PROBE, pb); $done(); return; }
  var t = tpl[key];
  var headers = { "Content-Type": t.ctype || "application/x-www-form-urlencoded", "Cookie": ck.value, "Referer": t.referer || "", "User-Agent": t.ua || "" };
  $httpClient.post({ url: t.url, headers: headers, body: t.body, timeout: 20 }, function (error, response, data) {
    if (error) { pb.netErr = (pb.netErr || 0) + 1; saveJ(K_PROBE, pb); $done(); return; }
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
    $done();
  });
})();
