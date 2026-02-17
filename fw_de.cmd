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

set "ARGS=--model large-v2 --language de --task transcribe --output_format srt --output_dir "%OUTDIR%" --compute_type float16 --standard --print_progress"

>"%LOG%" echo [%DATE% %TIME%] Input: %IN%
>>"%LOG%" echo [%DATE% %TIME%] Command: "%EXE%" "%IN%" %ARGS%
"%EXE%" "%IN%" %ARGS% >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  >>"%LOG%" echo [%DATE% %TIME%] float16 failed, retrying float32
  "%EXE%" "%IN%" --model large-v2 --language de --task transcribe --output_format srt --output_dir "%OUTDIR%" --compute_type float32 --standard --print_progress >>"%LOG%" 2>&1
  set "RC=%ERRORLEVEL%"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$srt=[IO.Path]::GetFullPath('%SRT%'); $txt=[IO.Path]::GetFullPath('%TXT%');" ^
  "if(Test-Path $srt){" ^
  "  $out = foreach($line in [IO.File]::ReadLines($srt,[Text.Encoding]::UTF8)){" ^
  "    if($line -match '^[ \t]*\[.*?-->\s*.*?\]\s*'){ $line = ($line -replace '^[ \t]*\[.*?-->\s*.*?\]\s*','') }" ^
  "    if($line -match '^[ \t]*\d+[ \t]*$'){ continue }" ^
  "    if($line -match '^[ \t]*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}[ \t]*$'){ continue }" ^
  "    if($line.Trim().Length -gt 0){ $line.TrimEnd() }" ^
  "  }; [IO.File]::WriteAllLines($txt,$out,[Text.Encoding]::UTF8)" ^
  "}"

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
