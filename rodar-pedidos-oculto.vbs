' Roda o ouvinte de pedidos iFood sem abrir janela (usado pelo Agendador de Tarefas)
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = "C:\pc-loja"
node = "node"
If fs.FileExists("C:\Program Files\nodejs\node.exe") Then node = """C:\Program Files\nodejs\node.exe"""
codigo = sh.Run("cmd /c " & node & " --env-file=config.env pedidos-ifood.mjs 2> pedidos-ifood-erro.txt", 0, True)
WScript.Quit codigo
