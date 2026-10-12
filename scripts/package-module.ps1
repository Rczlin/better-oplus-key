$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Module = Join-Path $Root "module"
$Prop = Join-Path $Module "module.prop"

# 版本号取自 module.prop，保证 zip 名与模块元数据一致。
$Version = (Get-Content $Prop | Where-Object { $_ -match '^version=' }) -replace '^version=', ''
if (-not $Version) { throw "version not found in module.prop" }

$Dist = Join-Path $Root "dist"
$Out = Join-Path $Dist "oplus-sidekey-$Version.zip"

if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

# 用 ZipArchive 手动写入，条目名统一为正斜杠 /。
# Compress-Archive 在 Windows 上会写入反斜杠 \，KSU 解压后目录结构会错误。
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$moduleFull = (Resolve-Path $Module).Path.TrimEnd('\')
$files = Get-ChildItem -Path $moduleFull -Recurse -File

$zip = [System.IO.Compression.ZipFile]::Open($Out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($moduleFull.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $zip.Dispose()
}

# module.prop 必须位于 zip 根目录，而不是子目录里。
Write-Output $Out
