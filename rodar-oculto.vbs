' Roda o robo sem abrir janela (usado pelo Agendador de Tarefas)
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = "C:\pc-loja"
node = "node"
If fs.FileExists("C:\Program Files\nodejs\node.exe") Then node = """C:\Program Files\nodejs\node.exe"""
sh.Run "cmd /c " & node & " --env-file=config.env coletar.mjs > ultimo-log.txt 2>&1", 0, True
