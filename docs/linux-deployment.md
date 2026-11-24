# Linux 服务器部署说明

## 当前部署

| 项目 | 值 |
| --- | --- |
| 公网地址 | `http://182.92.226.203/` |
| 服务器 | 阿里云轻量应用服务器，华北2（北京） |
| 系统 | Alibaba Cloud Linux 3.2104 |
| 规格 | 2 vCPU / 4 GiB / 50 GiB ESSD |
| 应用目录 | `/opt/uav` |
| 静态站点 | `/opt/uav/dist`（Nginx root） |
| Python venv | `/opt/uav/.venv`（Python 3.11） |
| 后端服务 | `uav-api.service`，监听 `127.0.0.1:8765` |
| Web 服务 | `nginx.service`，监听 80 |
| 数据目录 | `dist/data`；`/opt/uav/public` 是指向 `dist` 的软链接，供后端读取 `public/data/city.json` |

当前主界面“场景模型”下拉只展示：河南博物院、深圳国际交流中心、无锡市市民中心、杭州萧山机场。北京故宫、大兴机场、北京—通州铁路的数据已从部署包中剔除，源仓库仍保留。

## 目录结构

```text
/opt/uav
├── dist/                 # Vite 构建产物 + data
├── backend/              # Python 能力接口
├── equipment_models/     # 光电/声学模型包
├── deploy/               # Nginx/systemd/安装脚本
├── .venv/                # Python 3.11 虚拟环境
├── public -> dist        # 后端读取 public/data/city.json
└── requirements.txt
```

## 常用命令

```bash
# 服务状态
systemctl status uav-api nginx

# 重启
systemctl restart uav-api
systemctl reload nginx

# 日志
journalctl -u uav-api -f
tail -f /var/log/nginx/error.log /var/log/nginx/access.log

# 健康检查
curl http://127.0.0.1:8765/api/capabilities/health
curl -I http://127.0.0.1/
```

## 更新部署

在本地项目根目录（Windows Git Bash / PowerShell）：

```bash
bash scripts/build_linux_bundle.sh
```

生成 `artifacts/uav-linux-bundle.tar.gz`。然后在 PowerShell 中：

```powershell
.\scripts\upload_linux.ps1
```

或在服务器上手动：

```bash
scp -i ~/.ssh/uav_server_ed25519 artifacts/uav-linux-bundle.tar.gz root@182.92.226.203:/root/
ssh -i ~/.ssh/uav_server_ed25519 root@182.92.226.203 \
  "rm -rf /root/uav-linux && mkdir -p /root/uav-linux && \
   tar -xzf /root/uav-linux-bundle.tar.gz -C /root/uav-linux --strip-components=1 && \
   bash /root/uav-linux/deploy/install_linux.sh"
```

安装脚本会重建 `/opt/uav/dist`、`backend`、`equipment_models`、`.venv`，更新 Nginx/systemd 配置并重启服务；不会删除 `/opt/uav/.venv` 之外的业务数据。

## 首次安装要点

1. 服务器 SSH 只允许公钥；部署公钥在 `~/.ssh/uav_server_ed25519.pub`，对应私钥在本机 `~/.ssh/uav_server_ed25519`。如不再需要远程维护，可从服务器 `/root/.ssh/authorized_keys` 删除该行。
2. 阿里云轻量控制台 → 防火墙，放行 **80**（以及可选的 443）。
3. 当前使用 HTTP + 公网 IP，未配置域名/证书；如绑定域名并走大陆节点，需要按阿里云要求完成 ICP 备案。
4. 后端只监听 127.0.0.1，公网只能通过 Nginx 的 `/api/capabilities/` 反代访问。
5. 静态资源缓存：`/assets/` 一年 immutable；`.glb/.jpg/.png` 7 天；`.json` 每次回源校验。

## 资源与扩容

- 当前 2C4G 足够 1–20 人演示；20–50 人评审建议先观察 `free -m` 与带宽。
- 若带宽成为瓶颈，把 `dist/data` 迁到 OSS + CDN，Nginx 只保留页面与 API 反代。
- 后端依赖 Python 3.11；系统默认 Python 3.6 不要替换，venv 使用 `/usr/bin/python3.11`。
