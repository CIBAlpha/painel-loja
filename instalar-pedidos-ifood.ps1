<#
  Ouvinte de pedidos iFood (Painel da Loja) - instalacao no PC da loja
  ---------------------------------------------------------------------------
  1. Confere o Node.js e o Gestor iFood Kit em C:\pc-loja\vendor\gestor-ifood-kit
  2. Roda "npm install" na pasta do kit
  3. Cria o atalho "Gestor de Pedidos (kit)" (instalador do proprio kit)
  4. Agenda o ouvinte para ligar sozinho, escondido, quando o Windows entra
     (e religar se cair), e ja liga agora.

  Uso: clique duas vezes em instalar-pedidos-ifood.bat
  Para desligar e remover o agendamento: instalar-pedidos-ifood.bat -Remover
#>
param([switch]$Remover)

$ErrorActionPreference = 'Stop'
$PASTA = 'C:\pc-loja'
$KIT = Join-Path $PASTA 'vendor\gestor-ifood-kit'
$TAREFA = 'Pedidos iFood (Painel da Loja)'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TAREFA -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TAREFA -Confirm:$false
  }
  Write-Host 'Ouvinte de pedidos desligado e agendamento removido.'
  exit 0
}

Write-Host '[1/4] Conferindo Node.js e o kit...'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $node) { throw 'Node.js nao encontrado. Rode antes o instalar.bat do painel.' }
if (-not (Test-Path (Join-Path $KIT 'src\index.js'))) { throw ('Gestor iFood Kit nao encontrado em ' + $KIT) }
if (-not (Test-Path (Join-Path $PASTA 'config.env'))) { throw 'Falta o C:\pc-loja\config.env (o mesmo do robo do Gcom).' }
if (-not (Test-Path (Join-Path $PASTA 'pedidos-ifood.mjs'))) { throw 'Falta o C:\pc-loja\pedidos-ifood.mjs.' }

Write-Host '[2/4] npm install na pasta do kit...'
Push-Location $KIT
try { cmd /c 'npm install --no-audit --no-fund' ; if ($LASTEXITCODE -ne 0) { Write-Host '    Aviso: npm install falhou. Para ouvir pedidos nao faz falta; tente de novo depois.' } }
finally { Pop-Location }

Write-Host '[3/4] Atalho do Gestor de Pedidos com a conexao local...'
try { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $KIT 'windows\instalar.ps1') }
catch { Write-Host ('    Aviso: ' + $_.Exception.Message) }

Write-Host '[4/4] Agendando o ouvinte para ligar com o Windows...'
$usuario = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $PASTA 'rodar-pedidos-oculto.vbs') + '"') -WorkingDirectory $PASTA
$quando = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive
Register-ScheduledTask -TaskName $TAREFA -Action $acao -Trigger $quando -Settings $opcoes -Principal $quem -Force | Out-Null
Start-ScheduledTask -TaskName $TAREFA

Write-Host ''
Write-Host '===== PRONTO! ====='
Write-Host 'Agora FECHE o Gestor de Pedidos e abra pelo atalho "Gestor de Pedidos (kit)" na area de trabalho.'
Write-Host 'Para ver o ouvinte funcionando: clique duas vezes em ver-pedidos-ifood.bat'
