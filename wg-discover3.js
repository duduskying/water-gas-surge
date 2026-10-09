// 水电气 Surge 定向测试 v3 - 只盯燃气( catrq.com )与自来水( xazls.com )
// 记录: 序号/时间/路径/参数名/白名单判别参数值(type/flag/page等非敏感项)/请求头名/UA
//       Cookie名与总长/ntAuth长度/状态码/响应JSON字段名
// 绝不记录: Cookie值/token值/户号/ openid / code / 任何业务数据值
// 报告: https://example.com/wg-report   清空: https://example.com/wg-reset
(function () {
  var STORE_KEY = "wg_discover_v3";
  var REPORT_HOST = "example.com";
  var DISC_KEYS = ["type", "typecode", "flag", "page", "pagesize", "pageno", "pagenum",
    "noticetype", "method", "action", "function", "service", "cmd", "tab", "status",
    "querytype", "datatype", "data_type", "biztype", "biz_type", "module", "category",
    "fname", "processid", "func", "functionname", "function_name"];

  function now() { return Math.floor(Date.now() / 1000); }
  function load() {
    try {
      var s = $persistentStore.read(STORE_KEY);
      if (s) { var d = JSON.parse(s); if (d && d.hosts) return d; }
    } catch (e) {}
    return { ver: 2, started: now(), seq: 0, hosts: {}, notified: {} };
  }
  function save(d) {
    try { $persistentStore.write(JSON.stringify(d), STORE_KEY); }
    catch (e) { console.log("[WG2] save error: " + e); }
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
      if (/^\d+$/.test(p) || (p.length >= 10 && /[0-9]/.test(p) && /^[0-9a-zA-Z\-_]+$/.test(p))) parts[i] = ":id";
    }
    var r = parts.join("/");
    return r.length > 120 ? r.slice(0, 120) : r;
  }
  function queryPairs(url) {
    var s = String(url || ""), out = [];
    var q = s.indexOf("?");
    if (q < 0) return out;
    var qs = s.slice(q + 1);
    var h = qs.indexOf("#"); if (h >= 0) qs = qs.slice(0, h);
    qs.split("&").forEach(function (pr) {
      var kv = pr.split("=");
      var k = kv[0];
      try { k = decodeURIComponent(k); } catch (e) {}
      var v = kv.length > 1 ? kv.slice(1).join("=") : "";
      try { v = decodeURIComponent(v); } catch (e) {}
      if (k) out.push([k, v]);
    });
    return out;
  }
  function discVal(k, v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
    var s = String(v);
    if (s.length === 0 || s.length > 48) return null;
    if (/^[0-9a-fA-F]{24,}$/.test(s)) return null; // long hex looks like a token/code, skip
    return s;
  }
  function pickDisc(obj, out, depth) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 2) return;
    for (var k in obj) {
      var lk = k.toLowerCase();
      if (DISC_KEYS.indexOf(lk) >= 0 && !(k in out)) {
        var dv = discVal(k, obj[k]);
        if (dv !== null) out[k] = dv;
      }
      if (depth < 2 && obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) pickDisc(obj[k], out, depth + 1);
    }
  }
  function headerVal(headers, lowerName) {
    if (!headers) return null;
    for (var k in headers) { if (k.toLowerCase() === lowerName) return headers[k]; }
    return null;
  }
  function cookieNames(val) {
    var out = [];
    if (!val) return out;
    String(val).split(";").forEach(function (part) {
      var n = part.split("=")[0].replace(/^\s+|\s+$/g, "");
      if (n && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }
  function suspectHeaders(headers) {
    var out = [];
    if (!headers) return out;
    for (var k in headers) {
      var lk = k.toLowerCase();
      if (lk.indexOf("token") >= 0 || lk.indexOf("auth") >= 0 || lk.indexOf("session") >= 0 ||
          lk.indexOf("openid") >= 0 || lk.indexOf("union") >= 0 || lk.indexOf("sign") >= 0 || lk.indexOf("x-") === 0) {
        if (out.indexOf(k) < 0) out.push(k);
      }
    }
    return out;
  }
  function digData(obj, info) {
    // 燃气系统把真实载荷塞在单个 data 字段里(JSON字符串或对象), 挖出它的字段名与判别值
    if (!obj || typeof obj !== "object") return;
    var d = null;
    for (var k in obj) { if (k.toLowerCase() === "data") { d = obj[k]; break; } }
    if (d === null || d === undefined) return;
    var inner = null;
    if (typeof d === "string") {
      var t = d.replace(/^\s+/, "");
      if (t.charAt(0) === "{") { try { inner = JSON.parse(d); } catch (e) {} }
    } else if (typeof d === "object" && !Array.isArray(d)) { inner = d; }
    if (!inner) return;
    for (var kk in inner) { if (info.dataKeys.indexOf(kk) < 0 && info.dataKeys.length < 24) info.dataKeys.push(kk); }
    pickDisc(inner, info.disc, 0);
  }
  function bodyInfo(body) {
    var info = { keys: [], disc: {}, dataKeys: [] };
    if (!body || typeof body !== "string" || !body.length) return info;
    var t = body.replace(/^\s+/, "");
    if (t.charAt(0) === "{" || t.charAt(0) === "[") {
      try {
        var o = JSON.parse(body);
        if (o && typeof o === "object" && !Array.isArray(o)) {
          for (var k in o) { if (info.keys.length < 24) info.keys.push(k); }
          pickDisc(o, info.disc, 0);
          digData(o, info);
        }
      } catch (e) {}
      return info;
    }
    if (body.indexOf("=") >= 0) {
      var formObj = {};
      body.split("&").forEach(function (pr) {
        var kv = pr.split("=");
        var kk = kv[0];
        var vv = kv.length > 1 ? kv.slice(1).join("=") : "";
        try { vv = decodeURIComponent(vv.replace(/\+/g, " ")); } catch (e) {}
        if (kk) { formObj[kk] = vv; if (info.keys.indexOf(kk) < 0 && info.keys.length < 24) info.keys.push(kk); }
      });
      pickDisc(formObj, info.disc, 0);
      digData(formObj, info);
    }
    return info;
  }
  function collectKeys(obj, prefix, out, depth) {
    if (depth > 3 || out.length >= 60 || obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) { if (obj.length > 0) collectKeys(obj[0], prefix + "[]", out, depth + 1); return; }
    for (var k in obj) {
      var p = prefix ? prefix + "." + k : k;
      if (out.indexOf(p) < 0) out.push(p);
      collectKeys(obj[k], p, out, depth + 1);
      if (out.length >= 60) break;
    }
  }
  function union(dst, src) {
    for (var i = 0; i < src.length; i++) { if (dst.indexOf(src[i]) < 0) dst.push(src[i]); }
    return dst;
  }
  function getHost(data, host) {
    var h = data.hosts[host];
    if (!h) h = data.hosts[host] = { count: 0, respHits: 0, paths: {} };
    return h;
  }
  function getEntry(data, host, path) {
    var h = getHost(data, host);
    var e = h.paths[path];
    if (!e) {
      e = h.paths[path] = {
        count: 0, respCount: 0, seqFirst: 0, seqLast: 0, tFirst: 0, tLast: 0,
        methods: [], queryKeys: [], disc: {}, reqHeaders: [], ua: "", referer: "",
        cookieNames: [], cookieLen: 0, ntAuthLen: 0, suspect: [], bodyKeys: [], dataKeys: [],
        status: [], respHeaders: [], setCookieNames: [], ctype: "", json: false, respKeys: [], bodyLen: 0, err: ""
      };
    }
    return e;
  }
  function hasAuth(e) { return e.cookieNames.length > 0 || e.ntAuthLen > 0 || e.suspect.length > 0; }
  function buildReport(data) {
    var lines = [];
    lines.push("=== 水电气 Surge 定向测试报告 v2 ===");
    lines.push("开始时间戳: " + data.started + "  总请求序号: " + data.seq);
    lines.push("说明: 只有域名/路径/参数名/白名单判别值/字段名, 不含Cookie值/token值/户号/数据值.");
    lines.push("");
    Object.keys(data.hosts).forEach(function (h) {
      var hd = data.hosts[h];
      lines.push("## " + h + "  (请求 " + hd.count + ", 响应命中 " + hd.respHits + ")");
      var ps = Object.keys(hd.paths).map(function (p) { return [hd.paths[p].seqFirst || 99999, p]; });
      ps.sort(function (a, b) { return a[0] - b[0]; });
      ps.forEach(function (pair) {
        var p = pair[1], e = hd.paths[p];
        lines.push("  #" + e.seqFirst + " " + (e.methods.join("/") || "?") + " " + p + "  x" + e.count + " 响应x" + e.respCount);
        var dk = Object.keys(e.disc);
        if (dk.length) lines.push("    判别参数: " + dk.map(function (k) { return k + "=" + e.disc[k]; }).join(", "));
        if (e.queryKeys.length) lines.push("    query参数名: " + e.queryKeys.join(", "));
        if (e.bodyKeys.length) lines.push("    body参数名: " + e.bodyKeys.join(", "));
        if (e.dataKeys && e.dataKeys.length) lines.push("    data字段名: " + e.dataKeys.join(", "));
        if (e.cookieNames.length) lines.push("    Cookie名: " + e.cookieNames.join(", ") + " (值总长 " + e.cookieLen + ")");
        if (e.ntAuthLen) lines.push("    ntAuth头: 有 (值长 " + e.ntAuthLen + ")");
        if (e.suspect.length) lines.push("    可疑请求头: " + e.suspect.join(", "));
        if (e.referer) lines.push("    Referer路径: " + e.referer);
        if (e.status.length) lines.push("    状态码: " + e.status.join(", ") + "  类型: " + (e.ctype || "?") + "  响应长: " + e.bodyLen);
        if (e.setCookieNames.length) lines.push("    响应Set-Cookie名: " + e.setCookieNames.join(", "));
        if (e.respKeys.length) lines.push("    响应JSON字段: " + e.respKeys.join(", "));
        if (e.err) lines.push("    响应处理异常: " + e.err);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  var url = ($request && $request.url) || "";
  var host = hostOf(url);

  if (host === REPORT_HOST) {
    var rp = rawPathOf(url);
    if (rp.indexOf("/wg-reset") === 0) {
      $persistentStore.write("", STORE_KEY);
      $done({ response: { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "WG2: 已清空测试数据." } });
      return;
    }
    if (rp.indexOf("/wg-report") === 0) {
      $done({ response: { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: buildReport(load()) } });
      return;
    }
    $done({});
    return;
  }

  var path = anonPath(url);
  var data = load();

  // ---------- 请求阶段 ----------
  if (typeof $response === "undefined") {
    try {
      var e1 = getEntry(data, host, path);
      var hd1 = getHost(data, host);
      data.seq++;
      hd1.count++; e1.count++;
      if (!e1.seqFirst) { e1.seqFirst = data.seq; e1.tFirst = now(); }
      e1.seqLast = data.seq; e1.tLast = now();
      if ($request.method && e1.methods.indexOf($request.method) < 0) e1.methods.push($request.method);
      var pairs = queryPairs(url);
      var qObj = {};
      pairs.forEach(function (pr) {
        if (e1.queryKeys.indexOf(pr[0]) < 0 && e1.queryKeys.length < 24) e1.queryKeys.push(pr[0]);
        qObj[pr[0]] = pr[1];
      });
      pickDisc(qObj, e1.disc, 0);
      var rh = $request.headers || {};
      union(e1.reqHeaders, Object.keys(rh));
      union(e1.suspect, suspectHeaders(rh));
      var ua = headerVal(rh, "user-agent");
      if (ua) e1.ua = String(ua).slice(0, 160);
      var ref = headerVal(rh, "referer");
      if (ref) e1.referer = anonPath(ref);
      var ck = headerVal(rh, "cookie");
      if (ck) { union(e1.cookieNames, cookieNames(ck)); e1.cookieLen = String(ck).length; }
      var nt = headerVal(rh, "ntauth");
      if (nt) e1.ntAuthLen = String(nt).length;
      var bi = bodyInfo($request.body);
      union(e1.bodyKeys, bi.keys);
      union(e1.dataKeys, bi.dataKeys);
      for (var dk in bi.disc) { if (!(dk in e1.disc)) e1.disc[dk] = bi.disc[dk]; }
      save(data);
    } catch (err1) { console.log("[WG2] req error: " + err1); }
    $done({});
    return;
  }

  // ---------- 响应阶段(异常也必须落盘状态, 便于诊断) ----------
  var e2 = getEntry(data, host, path);
  try {
    var hd2 = getHost(data, host);
    hd2.respHits++; e2.respCount++;
    var rh2 = $response.headers || {};
    if (typeof $response.status === "number" && e2.status.indexOf($response.status) < 0) e2.status.push($response.status);
    union(e2.respHeaders, Object.keys(rh2));
    var sc = headerVal(rh2, "set-cookie");
    if (sc) {
      var attrs = ["path", "expires", "max-age", "domain", "secure", "httponly", "samesite", "priority", "partitioned"];
      union(e2.setCookieNames, cookieNames(sc).filter(function (n) { return attrs.indexOf(n.toLowerCase()) < 0; }));
    }
    var ct2 = headerVal(rh2, "content-type") || "";
    e2.ctype = ct2.split(";")[0];
    var body = (typeof $response.body === "string") ? $response.body : "";
    e2.bodyLen = body.length;
    if (body) {
      var t2 = body.replace(/^\s+/, "");
      if (ct2.indexOf("json") >= 0 || t2.charAt(0) === "{" || t2.charAt(0) === "[") {
        try {
          var obj = JSON.parse(body);
          var keys = [];
          collectKeys(obj, "", keys, 0);
          if (keys.length) { e2.json = true; union(e2.respKeys, keys); }
        } catch (errJson) {}
      }
    }
  } catch (err2) {
    e2.err = String(err2).slice(0, 120);
    console.log("[WG2] res error: " + err2);
  }
  save(data);
  if (e2.json && hasAuth(e2) && !data.notified[host]) {
    data.notified[host] = now();
    save(data);
    $notification.post("水电气测试v2:已捕获带登录态的JSON接口", host, "继续按顺序操作页面, 完成后打开 example.com/wg-report 回传.");
  }
  $done({});
})();
