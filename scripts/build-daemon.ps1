$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Ndk = if ($env:NDK) { $env:NDK } else { "L:\CodeProgram\Android\Sdk\ndk\28.2.13676358" }
$Cmake = "L:\CodeProgram\Embedded\STM32CubeCLT_1.19.0\CMake\bin\cmake.exe"
$Ninja = "L:\CodeProgram\Embedded\STM32CubeCLT_1.19.0\Ninja\bin\ninja.exe"
$Build = Join-Path $Root "build\android-arm64"
$Toolchain = Join-Path $Ndk "build\cmake\android.toolchain.cmake"

if (-not (Test-Path $Toolchain)) { throw "NDK toolchain not found: $Toolchain" }

& $Cmake -S (Join-Path $Root "daemon") -B $Build -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$Ninja" `
    "-DCMAKE_TOOLCHAIN_FILE=$Toolchain" `
    "-DANDROID_ABI=arm64-v8a" `
    "-DANDROID_PLATFORM=android-29" `
    "-DCMAKE_BUILD_TYPE=Release"
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }

& $Cmake --build $Build --target oplus-sidekey
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

$Out = Join-Path $Root "module\bin"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Copy-Item (Join-Path $Build "oplus-sidekey") (Join-Path $Out "oplus-sidekey") -Force
Write-Output "built: $(Join-Path $Out 'oplus-sidekey')"
