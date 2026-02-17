param(
  [string]$InstallDir = 'C:\Tools\FasterWhisperTranscribe',
  [string]$SampleFile,
  [switch]$ConfigureSharedHFCache,
  [string]$SharedHFCachePath = "$env:USERPROFILE\.cache\huggingface",
  [switch]$LinkPurfviewModelsToHF
)

$ErrorActionPreference = 'Stop'

function Write-FileUtf8NoBom {
  param([string]$Path,[string]$Content)
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path,$Content,$enc)
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$releaseApi = 'https://api.github.com/repos/Purfview/whisper-standalone-win/releases/tags/Faster-Whisper-XXL'
$release = Invoke-RestMethod -Uri $releaseApi
$asset = $release.assets | Where-Object { $_.name -eq 'Faster-Whisper-XXL_r245.4_windows.7z' } | Select-Object -First 1
if (-not $asset) { throw 'Could not find Faster-Whisper-XXL_r245.4_windows.7z asset.' }
$archive = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive

# Extract (Windows 11 tar.exe can unpack .7z; fallback to 7z if installed)
try {
  & tar -xf $archive -C $InstallDir
} catch {
  $sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
  if (-not $sevenZip) { throw 'Extraction failed. Install 7-Zip (winget install 7zip.7zip) or ensure tar can extract .7z.' }
  & $sevenZip x $archive "-o$InstallDir" -y | Out-Null
}

# If extracted into subfolder, move exe to root install dir
$exeFound = Get-ChildItem -Path $InstallDir -Filter 'faster-whisper-xxl.exe' -Recurse | Select-Object -First 1
if (-not $exeFound) { throw 'faster-whisper-xxl.exe not found after extraction.' }
if ($exeFound.DirectoryName -ne $InstallDir) {
  Copy-Item $exeFound.FullName (Join-Path $InstallDir 'faster-whisper-xxl.exe') -Force
}

$fwAuto = @'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "PYTHONUTF8=1"
if "%~1"=="" exit /b 2
set "IN=%~1"
set "OUTDIR=%~dp1"
if "%OUTDIR:~-1%"=="\" set "OUTDIR=%OUTDIR:~0,-1%"
set "BASE=%~n1"
set "SRT=%OUTDIR%\%BASE%.srt"
set "TXT=%OUTDIR%\%BASE%.txt"
set "LOG=%OUTDIR%\%BASE%.fwxxl.log"
set "EXE=%~dp0faster-whisper-xxl.exe"
if not exist "%EXE%" (
  >"%LOG%" echo ERROR: missing "%EXE%"
  notepad "%LOG%"
  exit /b 3
)
set "ARGS=--model large-v2 --language auto --task transcribe --output_format srt --output_dir "%OUTDIR%" --compute_type float16 --standard --print_progress"
>"%LOG%" echo [%DATE% %TIME%] Input: %IN%
>>"%LOG%" echo [%DATE% %TIME%] Command: "%EXE%" "%IN%" %ARGS%
"%EXE%" "%IN%" %ARGS% >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  >>"%LOG%" echo [%DATE% %TIME%] float16 failed, retrying float32
  "%EXE%" "%IN%" --model large-v2 --language auto --task transcribe --output_format srt --output_dir "%OUTDIR%" --compute_type float32 --standard --print_progress >>"%LOG%" 2>&1
  set "RC=%ERRORLEVEL%"
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$srt=[IO.Path]::GetFullPath('%SRT%'); $txt=[IO.Path]::GetFullPath('%TXT%'); if(Test-Path $srt){ $out = foreach($line in [IO.File]::ReadLines($srt,[Text.Encoding]::UTF8)){ if($line -match '^[ \t]*\[.*?-->\s*.*?\]\s*'){ $line = ($line -replace '^[ \t]*\[.*?-->\s*.*?\]\s*','') }; if($line -match '^[ \t]*\d+[ \t]*$'){ continue }; if($line -match '^[ \t]*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}[ \t]*$'){ continue }; if($line.Trim().Length -gt 0){ $line.TrimEnd() } }; [IO.File]::WriteAllLines($txt,$out,[Text.Encoding]::UTF8) }"
if not exist "%SRT%" (
  >>"%LOG%" echo [%DATE% %TIME%] ERROR: missing SRT output
  notepad "%LOG%"
  exit /b 4
)
if not "%RC%"=="0" (
  >>"%LOG%" echo [%DATE% %TIME%] ERROR: transcription failed with exit code %RC%
  notepad "%LOG%"
)
exit /b %RC%
'@

$fwDe = $fwAuto -replace '--language auto','--language de'
$fwEn = $fwAuto -replace '--language auto','--language en'

$fwSpk = @'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
set "PYTHONUTF8=1"
if "%~1"=="" exit /b 2
set "IN=%~1"
set "OUTDIR=%~dp1"
if "%OUTDIR:~-1%"=="\" set "OUTDIR=%OUTDIR:~0,-1%"
set "BASE=%~n1"
set "SRT=%OUTDIR%\%BASE%.speaker.srt"
set "TXT=%OUTDIR%\%BASE%.speakers.txt"
set "LOG=%OUTDIR%\%BASE%.fwxxl.log"
set "EXE=%~dp0faster-whisper-xxl.exe"
"%EXE%" "%IN%" --model large-v2 --language auto --task transcribe --output_format srt --output_dir "%OUTDIR%" --compute_type float16 --diarize pyannote_v3.1 --standard --print_progress >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
if exist "%OUTDIR%\%BASE%.srt" ren "%OUTDIR%\%BASE%.srt" "%BASE%.speaker.srt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$srt=[IO.Path]::GetFullPath('%SRT%'); $txt=[IO.Path]::GetFullPath('%TXT%'); if(Test-Path $srt){ $out = foreach($line in [IO.File]::ReadLines($srt,[Text.Encoding]::UTF8)){ if($line -match '^[ \t]*\d+[ \t]*$'){ continue }; if($line -match '^[ \t]*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}[ \t]*$'){ continue }; if($line.Trim().Length -gt 0){ $line.TrimEnd() } }; [IO.File]::WriteAllLines($txt,$out,[Text.Encoding]::UTF8) }"
if not exist "%SRT%" (
  >>"%LOG%" echo [%DATE% %TIME%] ERROR: missing speaker SRT output
  notepad "%LOG%"
  exit /b 4
)
if not "%RC%"=="0" notepad "%LOG%"
exit /b %RC%
'@

$regInstall = @'
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_Auto]
@="Transcribe (Auto)"
"Icon"="C:\\Tools\\FasterWhisperTranscribe\\faster-whisper-xxl.exe"
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_Auto\command]
@="\"C:\\Tools\\FasterWhisperTranscribe\\fw_auto.cmd\" \"%1\""
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_DE]
@="Transcribe (DE)"
"Icon"="C:\\Tools\\FasterWhisperTranscribe\\faster-whisper-xxl.exe"
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_DE\command]
@="\"C:\\Tools\\FasterWhisperTranscribe\\fw_de.cmd\" \"%1\""
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_EN]
@="Transcribe (EN)"
"Icon"="C:\\Tools\\FasterWhisperTranscribe\\faster-whisper-xxl.exe"
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_EN\command]
@="\"C:\\Tools\\FasterWhisperTranscribe\\fw_en.cmd\" \"%1\""
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_SPK]
@="Transcribe + Speakers"
"Icon"="C:\\Tools\\FasterWhisperTranscribe\\faster-whisper-xxl.exe"
[HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_SPK\command]
@="\"C:\\Tools\\FasterWhisperTranscribe\\fw_speakers.cmd\" \"%1\""
'@

$regUninstall = @'
Windows Registry Editor Version 5.00
[-HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_Auto]
[-HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_DE]
[-HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_EN]
[-HKEY_CURRENT_USER\Software\Classes\*\shell\FWXXL_SPK]
'@

Write-FileUtf8NoBom (Join-Path $InstallDir 'fw_auto.cmd') $fwAuto
Write-FileUtf8NoBom (Join-Path $InstallDir 'fw_de.cmd') $fwDe
Write-FileUtf8NoBom (Join-Path $InstallDir 'fw_en.cmd') $fwEn
Write-FileUtf8NoBom (Join-Path $InstallDir 'fw_speakers.cmd') $fwSpk
Write-FileUtf8NoBom (Join-Path $InstallDir 'install_context_menu.reg') $regInstall
Write-FileUtf8NoBom (Join-Path $InstallDir 'uninstall_context_menu.reg') $regUninstall

if ($ConfigureSharedHFCache) {
  [Environment]::SetEnvironmentVariable('HF_HOME', $SharedHFCachePath, 'User')
  [Environment]::SetEnvironmentVariable('HUGGINGFACE_HUB_CACHE', (Join-Path $SharedHFCachePath 'hub'), 'User')
  [Environment]::SetEnvironmentVariable('TRANSFORMERS_CACHE', (Join-Path $SharedHFCachePath 'hub'), 'User')
}

if ($LinkPurfviewModelsToHF) {
  $modelsDir = Join-Path $InstallDir '_models'
  if (Test-Path $modelsDir) { Remove-Item $modelsDir -Force -Recurse }
  New-Item -ItemType Junction -Path $modelsDir -Target (Join-Path $SharedHFCachePath 'hub') | Out-Null
}

reg import (Join-Path $InstallDir 'install_context_menu.reg') | Out-Null

if ($SampleFile) {
  & (Join-Path $InstallDir 'fw_auto.cmd') $SampleFile
}

Write-Host "Done. Restart Explorer: taskkill /f /im explorer.exe ; start explorer.exe"
