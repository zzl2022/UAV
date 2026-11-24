param(
    [string]$Server = "182.92.226.203",
    [string]$User = "root",
    [string]$Bundle = "artifacts\uav-linux-bundle.tar.gz",
    [string]$KeyFile = (Join-Path $HOME ".ssh\uav_server_ed25519")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Bundle)) {
    throw "找不到 $Bundle，请先在项目根目录运行：bash scripts/build_linux_bundle.sh"
}
if (-not (Test-Path $KeyFile)) {
    throw "找不到 SSH 私钥 $KeyFile；请先按说明把公钥加入服务器。"
}

Write-Host "上传 $Bundle 到 $User@$Server ..." -ForegroundColor Cyan
scp -i $KeyFile -o StrictHostKeyChecking=accept-new $Bundle "${User}@${Server}:/root/uav-linux-bundle.tar.gz"

Write-Host "在服务器上解压并安装 ..." -ForegroundColor Cyan
ssh -i $KeyFile -o StrictHostKeyChecking=accept-new "${User}@${Server}" "rm -rf /root/uav-linux && mkdir -p /root/uav-linux && tar -xzf /root/uav-linux-bundle.tar.gz -C /root/uav-linux --strip-components=1 && bash /root/uav-linux/deploy/install_linux.sh"

Write-Host "部署完成，访问：http://$Server/" -ForegroundColor Green
