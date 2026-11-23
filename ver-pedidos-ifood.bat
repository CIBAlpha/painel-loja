@echo off
chcp 65001 >nul
title Ouvinte de Pedidos iFood - ao vivo
cd /d C:\pc-loja
echo Mostrando o que o ouvinte de pedidos esta fazendo (atualiza sozinho).
echo Pode fechar esta janela a qualquer momento: o ouvinte continua ligado.
echo.
if not exist pedidos-ifood-log.txt echo (ainda sem registros - espere uns segundos) & timeout /t 10 >nul
powershell -NoProfile -Command "Get-Content -Path 'C:\pc-loja\pedidos-ifood-log.txt' -Encoding UTF8 -Tail 30 -Wait"
