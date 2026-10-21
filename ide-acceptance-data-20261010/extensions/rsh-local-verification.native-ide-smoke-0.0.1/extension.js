const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
exports.activate = function(context) {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  fs.writeFileSync(path.join(root, 'extension-activation.json'), JSON.stringify({node:process.versions.node,vscode:vscode.version,pid:process.pid}));
  context.subscriptions.push(vscode.commands.registerCommand('rsh.verifyNativeIde', async () => {
    fs.writeFileSync(path.join(root, 'extension-command.txt'), 'Node extension command executed');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(root, 'hello.txt')));
  }));
};
