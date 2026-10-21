# 教程视频独立托管

教程视频单独放在网站服务器，由 Nginx 提供 `/media/tutorials/`。GitHub 仓库和应用发布包只包含播放器、封面与来源说明。

| 文件 | 网页地址 |
| --- | --- |
| `maa-box.mp4` | `/media/tutorials/maa-box.mp4` |
| `manual-schedule-audio.mp4` | `/media/tutorials/manual-schedule-audio.mp4` |
| `shifts-orundum-audio.mp4` | `/media/tutorials/shifts-orundum-audio.mp4` |
| `export-maa.mp4` | `/media/tutorials/export-maa.mp4` |

生产媒体目录使用 `/opt/arknights-infra/shared/tutorial-videos/`，位于版本目录之外。视频单独上传或从服务器已有副本复制，校验 SHA-256 后发布；应用发布不上传、覆盖或删除这个目录。

`deploy/nginx-tutorial-videos.conf` 是网站 HTTPS `server` 块内的配置片段。安装前核对现有虚拟主机及目录权限，保留原配置备份，执行 `nginx -t` 成功后 reload。开发环境需要相同路径映射时，使用其独立的媒体目录。

播放器在点击后才加载视频，并保留 `preload="none"`。Nginx 直接响应文件及 HTTP Range 请求，视频无需经过 Next.js，也无需把服务器路径或新的环境变量放入前端构建。

按本次发布顺序，先部署网页代码，再单独安装视频文件和媒体路由。上传到临时文件并校验后，在同一文件系统原子重命名为正式文件；视频安装完成前，播放器保留现有加载失败提示和 B站来源链接。

验收包括三个文件的大小/校验和、`Content-Type: video/mp4`、Range 请求的 `206 Partial Content`、播放和拖动、手机宽度下的页面布局。媒体文件和临时文件不进入 GitHub、GitHub Actions artifacts 或应用 release。

本地开发如需播放，可以用本地反向代理映射该媒体路径；自动化播放器测试用本地文件模拟媒体响应。不得为方便调试把 MP4 重新复制到 `apps/arknights/public/`。

`.gitignore` 和仓库检查会阻止教程视频重新进入提交。从新版本删除文件不会清除旧 Git 历史；历史重写是另一个操作，本次不执行。

Nginx 路径映射参考：[alias 官方文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#alias)。
