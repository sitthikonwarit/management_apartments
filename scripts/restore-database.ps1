param(
    [string]$DumpFile
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root "backend\.env"
$backupDir = Join-Path $root "backend\backups"

if (-not (Test-Path $envFile)) {
    Write-Host "[ERROR] ไม่พบไฟล์ $envFile" -ForegroundColor Red
    exit 1
}

if (-not $DumpFile) {
    if (Test-Path $backupDir) {
        $latest = Get-ChildItem $backupDir -Filter *.dump -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) { $DumpFile = $latest.FullName }
    }
    if (-not $DumpFile) {
        Write-Host "[ERROR] ไม่พบไฟล์สำรองข้อมูล — ลากไฟล์ .dump มาวางบนไอคอน RestoreDatabase.cmd หรือรันด้วย: RestoreDatabase.cmd C:\path\to\file.dump" -ForegroundColor Red
        exit 1
    }
    Write-Host "ไม่ได้ระบุไฟล์ — ใช้ไฟล์สำรองล่าสุดที่พบ: $DumpFile" -ForegroundColor Cyan
}
if (-not (Test-Path $DumpFile)) {
    Write-Host "[ERROR] ไม่พบไฟล์: $DumpFile" -ForegroundColor Red
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

$pgRestore = Find-PgTool "pg_restore.exe"
$psql = Find-PgTool "psql.exe"
if (-not $pgRestore -or -not $psql) {
    Write-Host "[ERROR] ไม่พบ pg_restore.exe/psql.exe กรุณาติดตั้ง PostgreSQL (client tools) บนเครื่องนี้ก่อน" -ForegroundColor Red
    exit 1
}

Write-Host "=== นำเข้าฐานข้อมูล ===" -ForegroundColor Yellow
Write-Host "ไฟล์:    $DumpFile"
Write-Host "ปลายทาง: $pgUser@${pgHost}:$pgPort/$pgDb"
Write-Host ""
Write-Host "คำเตือน: การทำงานนี้จะลบข้อมูลเดิมทั้งหมดในฐานข้อมูล '$pgDb' แล้วแทนที่ด้วยข้อมูลจากไฟล์สำรอง!" -ForegroundColor Red
$confirm = Read-Host "พิมพ์ YES (ตัวพิมพ์ใหญ่) เพื่อยืนยันว่าต้องการดำเนินการต่อ"
if ($confirm -ne "YES") {
    Write-Host "ยกเลิกการนำเข้า" -ForegroundColor Yellow
    exit 0
}

$env:PGPASSWORD = $pgPassword

# เชื่อมไปฐาน postgres ก่อนเพื่อเช็ค/สร้างฐานข้อมูลปลายทาง ถ้ายังไม่มี (กรณีเครื่องใหม่ที่ยังไม่เคยมีฐานนี้)
$checkDb = & $psql -h $pgHost -p $pgPort -U $pgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$pgDb'"
if (-not $checkDb) {
    Write-Host "ไม่พบฐานข้อมูล '$pgDb' — กำลังสร้างใหม่..." -ForegroundColor Cyan
    & $psql -h $pgHost -p $pgPort -U $pgUser -d postgres -c "CREATE DATABASE `"$pgDb`""
}

& $pgRestore -h $pgHost -p $pgPort -U $pgUser -d $pgDb --clean --if-exists --no-owner --no-privileges $DumpFile
$exitCode = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "นำเข้าข้อมูลสำเร็จ" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[WARNING] pg_restore จบด้วย exit code $exitCode — บาง warning เรื่อง owner/role/extension เป็นเรื่องปกติ ถ้าไม่เห็น error รุนแรงให้เช็คข้อมูลในแอปต่อได้เลย" -ForegroundColor Yellow
}
