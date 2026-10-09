// 水电气 Surge 可见性测试 - 发现脚本 (v1)
// 只记录: 域名 / 路径(参数值已脱敏) / 参数名 / 请求头名 / Cookie名(非值) / 响应JSON字段名
// 绝不记录: Cookie值 / token值 / 账号 / 响应数据值
// 回传报告: Safari 打开 https://example.com/wg-report  (清空: /wg-reset)
(function () {
  var STORE_KEY = "wg_discover_v1";
  var REPORT_HOST = "example.com";
  var MAX_HOSTS = 120;
  var MAX_PATHS = 15;
  var MAX_KEYS = 60;

  function now() { return Math.floor(Date.now() / 1000); }

  function load() {
    try {
      var s = $persistentStore.read(STORE_KEY);
      if (s) { var d = JSON.parse(s); if (d && d.hosts) return d; }
    } catch (e) {}
    return { ver: 1, started: now(), hosts: {}, notified: {} };
  }
  function save(d) {
    try { $persistentStore.write(JSON.stringify(d), STORE_KEY); }
    catch (e) { console.log("[WG] save error: " + e); }
  }
  function hostOf(url) {
    var m = /^(?:https?):\/\/([^\/:?#]+)/i.exec(url || "");
    return m ? m[1].toLowerCase() : "";
  }
  function rawPathOf(url) {
    var s = String(url || "");
    var i = s.indexOf("://");
    if (i >= 0) s = s.slice(i + 3);
    var j = s.indexOf("/");
    s = j >= 0 ? s.slice(j) : "/";
    var q = s.indexOf("?");
    if (q >= 0) s = s.slice(0, q);
    var h = s.indexOf("#");
    if (h >= 0) s = s.slice(0, h);
    return s || "/";
  }
  function anonPath(url) {
    var parts = rawPathOf(url).split("/");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^\d+$/.test(p) || (p.length >= 10 && /[0-9]/.test(p) && /^[0-9a-zA-Z\-_]+$/.test(p))) {
        parts[i] = ":id";
      }
    }
    var r = parts.join("/");
    return r.length > 120 ? r.slice(0, 120) : r;
  }
  function queryKeysOf(url) {
    var s = String(url || ""), out = [];
    var q = s.indexOf("?");
    if (q < 0) return out;
    var qs = s.slice(q + 1);
    var h = qs.indexOf("#"); if (h >= 0) qs = qs.slice(0, h);
    var pairs = qs.split("&");
    for (var i = 0; i < pairs.length && out.length < 20; i++) {
      var k = pairs[i].split("=")[0];
      try { k = decodeURIComponent(k); } catch (e) {}
      if (k && out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }
  function headerVal(headers, lowerName) {
    if (!headers) return null;
    for (var k in headers) { if (k.toLowerCase() === lowerName) return headers[k]; }
    return null;
  }
  function cookieNames(val) {
    var out = [];
    if (!val) return out;
    var parts = String(val).split(";");
    for (var i = 0; i < parts.length; i++) {
      var n = parts[i].split("=")[0].replace(/^\s+|\s+$/g, "");
      if (n && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  }
  function suspectHeaders(headers) {
    var out = [];
    if (!headers) return out;
    for (var k in headers) {
      var lk = k.toLowerCase();
      if (lk.indexOf("token") >= 0 || lk.indexOf("auth") >= 0 || lk.indexOf("session") >= 0 ||
          lk.indexOf("openid") >= 0 || lk.indexOf("union") >= 0 || lk.indexOf("sign") >= 0 ||
          lk.indexOf("x-") === 0) {
        if (out.indexOf(k) < 0) out.push(k);
      }
    }
    return out;
  }
  function bodyKeysOf(body, ctype) {
    var out = [];
    if (!body || typeof body !== "string") return out;
    if (ctype && ctype.indexOf("json") >= 0) {
      try {
        var o = JSON.parse(body);
        if (o && typeof o === "object" && !Array.isArray(o)) {
          for (var k in o) { if (out.length < 20) out.push(k); }
        }
      } catch (e) {}
    } else if (ctype && ctype.indexOf("urlencoded") >= 0) {
      var pairs = body.split("&");
      for (var i = 0; i < pairs.length && out.length < 20; i++) {
        var kk = pairs[i].split("=")[0];
        if (kk && out.indexOf(kk) < 0) out.push(kk);
      }
    }
    return out;
  }
  function collectKeys(obj, prefix, out, depth) {
    if (depth > 3 || out.length >= MAX_KEYS || obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      if (obj.length > 0) collectKeys(obj[0], prefix + "[]", out, depth + 1);
      return;
    }
    for (var k in obj) {
      var p = prefix ? prefix + "." + k : k;
      if (out.indexOf(p) < 0) out.push(p);
      collectKeys(obj[k], p, out, depth + 1);
      if (out.length >= MAX_KEYS) break;
    }
  }
  function union(dst, src) {
    for (var i = 0; i < src.length; i++) { if (dst.indexOf(src[i]) < 0) dst.push(src[i]); }
    return dst;
  }
  function isNoise(host) {
    if (!host || host === REPORT_HOST) return true;
    var suffixes = ["apple.com", "icloud.com", "icloud-content.com", "mzstatic.com", "push.apple.com", "apple-mapkit.com", "aaplimg.com"];
    for (var i = 0; i < suffixes.length; i++) {
      if (host === suffixes[i] || host.slice(-(suffixes[i].length + 1)) === "." + suffixes[i]) return true;
    }
    return false;
  }
  function getEntry(data, host, path) {
    var h = data.hosts[host];
    if (!h) {
      var n = 0; for (var _ in data.hosts) n++;
      if (n >= MAX_HOSTS) return null;
      h = data.hosts[host] = { count: 0, paths: {} };
    }
    var e = h.paths[path];
    if (!e) {
      var m = 0; for (var _2 in h.paths) m++;
      if (m >= MAX_PATHS) return null;
      e = h.paths[path] = {
        count: 0, methods: [], queryKeys: [], reqHeaders: [], suspect: [],
        cookieNames: [], cookieLen: 0, bodyKeys: [],
        status: [], respHeaders: [], setCookieNames: [], ctype: "", json: false, respKeys: [], bodyLen: 0
      };
    }
    return e;
  }
  function isCandidate(e) {
    return e.json && (e.cookieNames.length > 0 || e.suspect.length > 0);
  }
  function buildReport(data) {
    var lines = [];
    var hosts = Object.keys(data.hosts);
    lines.push("=== 水电气 Surge 可见性测试报告 v1 ===");
    lines.push("开始时间戳: " + data.started + "  捕获域名数: " + hosts.length);
    lines.push("说明: 本报告只有域名/路径/参数名/字段名, 不含Cookie值/token值/账号/数据值.");
    lines.push("");
    var cand = [], rest = [];
    hosts.forEach(function (h) {
      var any = false, ps = data.hosts[h].paths;
      for (var p in ps) { if (isCandidate(ps[p])) { any = true; break; } }
      (any ? cand : rest).push(h);
    });
    function dump(h) {
      var hd = data.hosts[h];
      lines.push("## " + h + "  (请求数 " + hd.count + ")");
      for (var p in hd.paths) {
        var e = hd.paths[p];
        lines.push("  " + (e.methods.join("/") || "?") + " " + p + "  x" + e.count + (isCandidate(e) ? "  <== 候选接口" : ""));
        if (e.queryKeys.length) lines.push("    query参数名: " + e.queryKeys.join(", "));
        if (e.bodyKeys.length) lines.push("    body参数名: " + e.bodyKeys.join(", "));
        if (e.cookieNames.length) lines.push("    Cookie名: " + e.cookieNames.join(", ") + " (值总长 " + e.cookieLen + ")");
        if (e.suspect.length) lines.push("    可疑请求头: " + e.suspect.join(", "));
        if (e.status.length) lines.push("    状态码: " + e.status.join(", ") + "  类型: " + (e.ctype || "?") + "  响应长: " + e.bodyLen);
        if (e.setCookieNames.length) lines.push("    响应Set-Cookie名: " + e.setCookieNames.join(", "));
        if (e.respKeys.length) lines.push("    响应JSON字段: " + e.respKeys.join(", "));
      }
    }
    lines.push("--- 候选接口域名 (" + cand.length + ") ---");
    cand.forEach(dump);
    lines.push("");
    lines.push("--- 其他域名 (" + rest.length + ") ---");
    rest.forEach(dump);
    return lines.join("\n");
  }

  var url = ($request && $request.url) || "";
  var host = hostOf(url);

  // ---------- 报告/清空 入口 ----------
  if (host === REPORT_HOST) {
    var rp = rawPathOf(url);
    if (rp.indexOf("/wg-reset") === 0) {
      $persistentStore.write("", STORE_KEY);
      $done({ response: { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "WG: 已清空测试数据." } });
      return;
    }
    if (rp.indexOf("/wg-report") === 0) {
      $done({ response: { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: buildReport(load()) } });
      return;
    }
    $done({});
    return;
  }

  if (isNoise(host)) { $done({}); return; }

  var path = anonPath(url);
  var data = load();

  // ---------- 请求阶段 ----------
  if (typeof $response === "undefined") {
    var e1 = getEntry(data, host, path);
    if (e1) {
      var hd = data.hosts[host]; hd.count++; e1.count++;
      if ($request.method && e1.methods.indexOf($request.method) < 0) e1.methods.push($request.method);
      union(e1.queryKeys, queryKeysOf(url));
      var rh = $request.headers || {};
      union(e1.reqHeaders, Object.keys(rh));
      union(e1.suspect, suspectHeaders(rh));
      var ck = headerVal(rh, "cookie");
      if (ck) { union(e1.cookieNames, cookieNames(ck)); e1.cookieLen = String(ck).length; }
      var ct1 = headerVal(rh, "content-type") || "";
      union(e1.bodyKeys, bodyKeysOf($request.body, ct1));
      save(data);
    }
    $done({});
    return;
  }

  // ---------- 响应阶段 ----------
  var e2 = getEntry(data, host, path);
  if (e2) {
    var rh2 = $response.headers || {};
    if (typeof $response.status === "number" && e2.status.indexOf($response.status) < 0) e2.status.push($response.status);
    union(e2.respHeaders, Object.keys(rh2));
    var sc = headerVal(rh2, "set-cookie");
    if (sc) {
      var attrs = ["path", "expires", "max-age", "domain", "secure", "httponly", "samesite", "priority", "partitioned"];
      var scNames = cookieNames(sc).filter(function (n) { return attrs.indexOf(n.toLowerCase()) < 0; });
      union(e2.setCookieNames, scNames);
    }
    var ct2 = headerVal(rh2, "content-type") || "";
    e2.ctype = ct2.split(";")[0];
    var body = (typeof $response.body === "string") ? $response.body : "";
    e2.bodyLen = body.length;
    if (body && (ct2.indexOf("json") >= 0 || body.charAt(0) === "{" || body.charAt(0) === "[")) {
      try {
        var obj = JSON.parse(body);
        var keys = [];
        collectKeys(obj, "", keys, 0);
        if (keys.length) { e2.json = true; union(e2.respKeys, keys); }
      } catch (err) {}
    }
    save(data);
    if (isCandidate(e2) && !data.notified[host]) {
      data.notified[host] = now();
      save(data);
      console.log("[WG] candidate: " + host + " " + path);
      $notification.post("水电气测试:发现候选接口", host, "路径 " + path + " 带登录态且返回JSON. 两个小程序都操作完后, 用Safari打开 example.com/wg-report 回传报告.");
    }
  }
  $done({});
})();
