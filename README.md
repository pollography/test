# FasterWhisperTranscribe (Windows 11 Kontextmenü, lokal, ohne Cloud)

Dieses Paket richtet Purfview **Faster-Whisper-XXL r245.4** so ein, dass per Rechtsklick direkt im Quellordner erzeugt wird:
- `<basename>.srt`
- `<basename>.txt`
- `<basename>.fwxxl.log`

Optionaler Eintrag: **Transcribe + Speakers** (Diarization) mit
- `<basename>.speaker.srt`
- `<basename>.speakers.txt`

## Verifizierte CLI-Basis (r245.4)
Aus Purfview-Doku/Repo:
- `--model`
- `--language` (`-l` in Beispielen)
- `--output_dir` (`-o` in Beispielen)
- `--output_format`
- `--compute_type`
- `--task transcribe`
- `--diarize` (inkl. Optionen wie `pyannote_v3.1` laut Changelog)
- `--help`

Wenn du lokal 100% gegen deine EXE prüfen willst:
```bat
C:\Tools\FasterWhisperTranscribe\faster-whisper-xxl.exe --help
```

## Wichtige Stabilitätsentscheidungen
- **RTX 50xx cuBLAS-Problem**: Standard ist `--compute_type float16`, bei Fehler Retry auf `float32`.
- **Windows-Quoting-Bug** (`%~dp1` endet mit `\`): Skripte schneiden den finalen Backslash vor `--output_dir` ab.
- **SRT->TXT robust**: entfernt sowohl
  - normale SRT-Zeitzeilen `00:00:00,000 --> ...`
  - als auch Prefix-Zeitstempel wie `[00:06.190 --> 00:07.590] text`

## One-Click Installation (empfohlen)
1. Öffne PowerShell **als normaler User** (kein Admin nötig).
2. Erlaube Skriptausführung nur für diese Session:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   ```
3. Starte Installer:
   ```powershell
   cd C:\Tools\FasterWhisperTranscribe
   .\install.ps1
   ```
4. Explorer neu starten (damit Kontextmenü sofort sichtbar ist):
   ```bat
   taskkill /f /im explorer.exe
   start explorer.exe
   ```
5. Rechtsklick auf Audio/Video -> **Show more options** -> `Transcribe (Auto|DE|EN)`.

## Manuelle Installation (für Dummies)
1. Ordner anlegen:
   ```
   C:\Tools\FasterWhisperTranscribe\
   ```
2. Purfview Release `Faster-Whisper-XXL_r245.4_windows.7z` laden und entpacken.
3. Sicherstellen, dass `faster-whisper-xxl.exe` in `C:\Tools\FasterWhisperTranscribe\` liegt.
4. Diese Dateien in denselben Ordner legen: `fw_auto.cmd`, `fw_de.cmd`, `fw_en.cmd`, `fw_speakers.cmd`, `install_context_menu.reg`, `uninstall_context_menu.reg`.
5. Registry installieren:
   ```bat
   reg import "C:\Tools\FasterWhisperTranscribe\install_context_menu.reg"
   ```
6. Explorer neu starten.

## FFmpeg nötig?
Für Faster-Whisper-XXL r245.4 sind laut Purfview die nötigen Laufzeitbibliotheken enthalten (Standalone-Paket). In der Praxis ist meist **kein extra ffmpeg.exe auf PATH** nötig.

Falls bei dir trotzdem Decoder-Fehler im `.fwxxl.log` stehen:
- Winget:
  ```powershell
  winget install Gyan.FFmpeg
  ```
- oder Chocolatey:
  ```powershell
  choco install ffmpeg
  ```

## Modelle (kein doppelter Download)
### Whisper Key Local: Cache-Ort und Format
Whisper Key Local nutzt auf Windows standardmäßig HuggingFace-Cache unter:
- `%USERPROFILE%\.cache\huggingface\hub\models--...`

Es verwendet `faster_whisper.WhisperModel(...)` und damit CTranslate2-kompatible Modelldaten (Model-Ordner/Snapshots).

### Purfview Faster-Whisper-XXL
Laut Purfview-README sucht die EXE standardmäßig lokal in:
- `C:\Tools\FasterWhisperTranscribe\_models\...`

### Kompatibilität / Empfehlung
Direktes 1:1-Sharing ist nicht immer sauber (Namensschema `_models\faster-whisper-*` vs HF `models--...\snapshots\...`).
Pragmatisch und robust:
1. **Empfohlen**: gemeinsamer HF-Cache per User-ENV setzen:
   ```powershell
   setx HF_HOME "%USERPROFILE%\.cache\huggingface"
   setx HUGGINGFACE_HUB_CACHE "%USERPROFILE%\.cache\huggingface\hub"
   setx TRANSFORMERS_CACHE "%USERPROFILE%\.cache\huggingface\hub"
   ```
2. Optional experimentell: `_models` auf HF-Cache junctionen (nur wenn dein Setup getestet ist):
   ```bat
   mklink /J "C:\Tools\FasterWhisperTranscribe\_models" "%USERPROFILE%\.cache\huggingface\hub"
   ```

`install.ps1` unterstützt beides über Schalter:
```powershell
.\install.ps1 -ConfigureSharedHFCache
.\install.ps1 -ConfigureSharedHFCache -LinkPurfviewModelsToHF
```

## Modell ändern
In `fw_*.cmd` `--model large-v2` ändern, z. B. auf `turbo`.
Hinweis: Purfview weist darauf hin, dass large-v3 nicht immer besser als large-v2 ist. Deshalb ist hier **large-v2 default**.

## Compute Type ändern
In `fw_*.cmd` `--compute_type float16` ändern (z. B. `float32`).

## Uninstall
```bat
reg import "C:\Tools\FasterWhisperTranscribe\uninstall_context_menu.reg"
```
Optional Dateien löschen:
```bat
rmdir /s /q "C:\Tools\FasterWhisperTranscribe"
```

## Testplan / Verifikation
1. Help prüfen:
```bat
C:\Tools\FasterWhisperTranscribe\faster-whisper-xxl.exe --help
```
2. Auto-Test:
```bat
C:\Tools\FasterWhisperTranscribe\fw_auto.cmd "D:\Medien\testfile.mp4"
```
3. Erwartete Dateien im gleichen Ordner wie Input:
- `testfile.srt`
- `testfile.txt`
- `testfile.fwxxl.log`
4. Speaker-Test:
```bat
C:\Tools\FasterWhisperTranscribe\fw_speakers.cmd "D:\Medien\testfile.mp4"
```
Erwartet zusätzlich:
- `testfile.speaker.srt`
- `testfile.speakers.txt`
