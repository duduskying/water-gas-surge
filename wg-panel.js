// 水电气 Surge 可见性测试 - 状态面板 (v1)
// 读 wg-discover.js 存下的数据, 汇总候选域名; 无数据时给出操作提示.
(function () {
  var STORE_KEY = "wg_discover_v1";
  function isCandidate(e) {
    return e.json && (e.cookieNames.length > 0 || e.suspect.length > 0);
  }
  var content = "";
  try {
    var s = $persistentStore.read(STORE_KEY);
    var data = s ? JSON.parse(s) : null;
    if (!data || !data.hosts || Object.keys(data.hosts).length === 0) {
      content = "还没有捕获到数据。\n请确认模块已启用、MITM已开, 然后打开燃气/自来水小程序并进入余额/用量页面。";
    } else {
      var hosts = Object.keys(data.hosts);
      var cand = [];
      hosts.forEach(function (h) {
        var ps = data.hosts[h].paths;
        for (var p in ps) { if (isCandidate(ps[p])) { cand.push(h); break; } }
      });
      var lines = [];
      lines.push("捕获域名: " + hosts.length + " 个, 候选接口: " + cand.length + " 个");
      cand.slice(0, 8).forEach(function (h) { lines.push("★ " + h); });
      if (cand.length === 0) lines.push("(暂未发现带登录态的JSON接口, 请在小程序里多点几个页面)");
      lines.push("完整报告: Safari 打开 example.com/wg-report");
      content = lines.join("\n");
    }
  } catch (e) {
    content = "读取测试数据出错: " + e;
  }
  $done({ title: "水电气可见性测试", content: content, icon: "drop.fill", "icon-color": "#3A8FB7" });
})();
