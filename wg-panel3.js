// 水电气 Surge 定向测试 v3 - 状态面板
(function () {
  var STORE_KEY = "wg_discover_v3";
  function hasAuth(e) { return e.cookieNames.length > 0 || e.ntAuthLen > 0 || e.suspect.length > 0; }
  var content = "";
  try {
    var s = $persistentStore.read(STORE_KEY);
    var data = s ? JSON.parse(s) : null;
    if (!data || !data.hosts || Object.keys(data.hosts).length === 0) {
      content = "还没有数据。\n确认 v2 模块已启用后, 打开燃气或自来水小程序并进入余额/用量页面。";
    } else {
      var lines = [];
      Object.keys(data.hosts).forEach(function (h) {
        var hd = data.hosts[h];
        var cand = 0;
        for (var p in hd.paths) { var e = hd.paths[p]; if (e.json && hasAuth(e)) cand++; }
        lines.push(h + "  请求" + hd.count + " 响应" + hd.respHits + " 数据接口" + cand);
      });
      lines.push("完整报告: Safari 打开 example.com/wg-report");
      content = lines.join("\n");
    }
  } catch (e) {
    content = "读取出错: " + e;
  }
  $done({ title: "水电气定向测试 v3", content: content, icon: "drop.fill", "icon-color": "#3A8FB7" });
})();
