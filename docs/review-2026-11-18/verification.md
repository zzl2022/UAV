# 修改验证记录

基线 27ea7fd2ba190d1bff2b838a8996764e1b0f764b，验证日期 2026-11-18。

- npm ci --ignore-scripts：成功安装41个包。
- npm test：164项通过，0失败，0跳过。其中新增3项验证活动模型参数覆盖、无线电预算抵消与光电近地视场几何。
- npm run build：通过。存在项目既有的大分块体积提示，不影响构建成功。
- node scripts/interaction_update_browser_smoke.js：Edge无头浏览器通过。实际操作完整场景，覆盖目标尺寸命名、目标参数生效反馈、目标地图选点、第二次点击不再移动目标、环境参数成功反馈、旧判定参数不再出现在雷达参数页面、设备演示单次选点；未捕获到页面脚本异常。
- node scripts/verify_review_documents.js：两份HTML文档渲染成功，所有章节可访问，无横向溢出；已查看文档首部及参数表截图。
- git diff --check：通过。

浏览器回归启动前先运行 npm run dev -- --port 5178；如使用其他地址，设置 APP_URL。Windows默认使用已安装的Microsoft Edge，可通过CHROMIUM_PATH指定Chromium。

本轮没有重新验证全部Python资料核对服务，也没有执行现场设备试验。原理与参数报告中的Python路径结论来自源码与配置核查；本次未修改Python模型。
