$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root "backend\.env"
$backupDir = Join-Path $root "backend\backups"

if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] ไม่พบไฟล์ $envFile" -ForegroundColor Red
    exit 1
}

$line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) {
    Write-Host "[ERROR] ไม่พบ DATABASE_URL ใน .env" -ForegroundColor Red
    exit 1
}
$urlStr = ($line -replace '^DATABASE_URL=', '').Trim()
$uri = [Uri]$urlStr
$userInfo = $uri.UserInfo -split ':', 2
$pgUser = $userInfo[0]
$pgPassword = $userInfo[1]
$pgHost = $uri.Host
$pgPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$pgDb = $uri.AbsolutePath.TrimStart('/')

function Find-PgTool($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$name" -ErrorAction SilentlyContinue
    if ($candidates) { return $candidates[0].FullName }
    return $null
}

$pgDump = Find-PgTool "pg_dump.exe"
if (-not $pgDump) {
    Write-Host "[ERROR] ไม่พบ pg_dump.exe กรุณาติดตั้ง PostgreSQL (client tools)" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $backupDir "$pgDb-$timestamp.dump"

Write-Host "=== สำรองฐานข้อมูล ===" -ForegroundColor Yellow
Write-Host "จาก:  $pgUser@${pgHost}:$pgPort/$pgDb"
Write-Host "ไปที่: $outFile"
Write-Host ""

$env:PGPASSWORD = $pgPassword
& $pgDump -h $pgHost -p $pgPort -U $pgUser -d $pgDb -F c -f $outFile
$exitCode = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "สำรองข้อมูลสำเร็จ: $outFile" -ForegroundColor Green
    Write-Host "คัดลอกไฟล์นี้ไปเครื่องปลายทาง แล้วรัน RestoreDatabase.cmd ที่นั่นเพื่อนำเข้า (ลากไฟล์มาวางบนไอคอนก็ได้)" -ForegroundColor Green
} else {
    Write-Host "[ERROR] pg_dump ล้มเหลว (exit code $exitCode)" -ForegroundColor Red
    exit $exitCode
}
