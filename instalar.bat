@echo off
chcp 65001 >nul
title Instalador do Robo do Painel da Loja
set "ORIGEM=%~dp0"
set "DEST=C:\pc-loja"

echo [1/5] Verificando o Node.js...
set "NODEDIR=C:\Program Files\nodejs"
if exist "%NODEDIR%\node.exe" goto temnode
where node >nul 2>nul && goto temnode
echo     Instalando o Node.js LTS (pode pedir permissao do Windows: clique em Sim)...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
:temnode
set "PATH=%NODEDIR%;%APPDATA%\npm;%PATH%"
node -v || (echo ERRO: Node.js nao instalou. & pause & exit /b 1)

echo [2/5] Copiando arquivos para %DEST%...
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%ORIGEM%..\coletar.mjs" "%DEST%\" >nul
copy /y "%ORIGEM%..\package.json" "%DEST%\" >nul
copy /y "%ORIGEM%rodar-oculto.vbs" "%DEST%\" >nul
copy /y "%ORIGEM%testar.bat" "%DEST%\" >nul
if not exist "%DEST%\config.env" copy /y "%ORIGEM%config.env.exemplo" "%DEST%\config.env" >nul

cd /d "%DEST%"
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /q package-lock.json
echo [3/5] npm install...
call npm install || (echo ERRO no npm install & pause & exit /b 1)

echo [4/5] Verificando o Google Chrome...
set "TEMCHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set TEMCHROME=1
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set TEMCHROME=1
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set TEMCHROME=1
if defined TEMCHROME goto chromeok
call npx playwright install chromium
goto agendar
:chromeok
echo     Chrome encontrado, o robo vai usar ele.
:agendar

echo [5/5] Agendando: todo dia das 10h as 2h, a cada 15 min, sem janela...
schtasks /create /f /tn "Robo Painel Loja" /sc daily /st 10:00 /ri 15 /du 16:00 /tr "wscript.exe \"C:\pc-loja\rodar-oculto.vbs\""

echo.
echo ===== PRONTO! =====
echo Falta so preencher o C:\pc-loja\config.env e rodar o testar.bat
pause
