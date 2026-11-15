@echo off
chcp 65001 >nul
cd /d C:\pc-loja
set "NODE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
echo Testando o robo... (leva uns 30 segundos)
echo.
"%NODE%" --env-file=config.env coletar.mjs
echo.
echo Se apareceu "OK" acima, deu certo. Pode fechar esta janela.
pause
