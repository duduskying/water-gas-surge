// 水电气正式版 - 状态面板
(function () {
  function now() { return Math.floor(Date.now() / 1000); }
  function loadJ(k) { try { var s = $persistentStore.read(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function ageStr(ts) { if (!ts) return "无"; var s = now() - ts; if (s < 3600) return Math.floor(s / 60) + "分钟前"; if (s < 86400) return Math.floor(s / 3600) + "小时前"; return Math.floor(s / 86400) + "天前"; }
  var L = [];
  var g = loadJ("wg_gas_data"), ck = loadJ("wg_gas_cookie");
  L.push("— 燃气 —");
  if (g) {
    var parts = [];
    if (g.surplus_gas !== undefined && g.surplus_gas !== null) parts.push("剩余 " + g.surplus_gas + " 方");
    if (g.reading !== undefined && g.reading !== null) parts.push("读数 " + g.reading);
    if (g.totalgas !== undefined && g.totalgas !== null) parts.push("累计 " + g.totalgas + " 方");
    L.push(parts.length ? parts.join(" · ") : "已捕获,字段待核对");
    if (g.last_time) L.push("最近购气: " + g.last_time + " " + g.last_money + "元");
    L.push("更新: " + ageStr(g.ts) + "(" + (g.src || "?") + ") 会话: " + ageStr(ck && ck.ts));
  } else L.push("暂无数据,请打开一次燃气小程序");
  var w = loadJ("wg_water_data"), wt = loadJ("wg_water_token"), ws = loadJ("wg_water_status");
  L.push("— 自来水 —");
  if (w) {
    var p2 = [];
    if (w.balanceFee !== undefined) p2.push("余额字段 " + w.balanceFee);
    if (w.arrears_amount !== undefined) p2.push("金额 " + w.arrears_amount);
    if (w.monthVolume !== undefined) p2.push("本月 " + w.monthVolume + " m³");
    L.push(p2.join(" · ") || "已采集,字段待核对");
    L.push("更新: " + ageStr(w.ts) + " 令牌刷新: " + ageStr(wt && wt.updated));
  } else if (!wt) L.push("令牌未设置: 请打开 example.com/wg-setup");
  else L.push("已设置令牌,等待首次采集" + (ws && ws.lastError ? " (上次错误: " + ws.lastError + ")" : ""));
  $done({ title: "水电气 v1.5", content: L.join("\n"), icon: "drop.fill", "icon-color": "#3A8FB7" });
})();
