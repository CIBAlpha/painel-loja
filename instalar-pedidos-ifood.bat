@echo off
chcp 65001 >nul
title Instalador do Ouvinte de Pedidos iFood
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\pc-loja\instalar-pedidos-ifood.ps1" %*
echo.
pause
