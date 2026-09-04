import * as vscode from 'vscode';

const IGNORED = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build',
  'target', '.next', '.nuxt', '.cache', '.turbo', '.venv', 'vendor', '__pycache__'
]);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let busy = false;

export function activate(ctx: vscode.ExtensionContext) {
  const reg = (cmd: string, action: 'expand' | 'collapse') =>
    ctx.subscriptions.push(
      vscode.commands.registerCommand(cmd, (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        run(action, uris?.length ? uris : uri ? [uri] : undefined)
      )
    );

  reg('fileExplorer.expandRecursively', 'expand');
  reg('fileExplorer.collapseRecursively', 'collapse');
}

async function run(action: 'expand' | 'collapse', targets?: vscode.Uri[]) {
  if (busy) return;
  busy = true;

  try {
    const dirs = targets
      ? (await Promise.all(targets.map(toDir))).filter((d): d is vscode.Uri => !!d)
      : [await getTarget()].filter((d): d is vscode.Uri => !!d);

    if (!dirs.length) return;

    for (const dir of dirs) {
      if (action === 'collapse') {
        await vscode.commands.executeCommand('revealInExplorer', dir);
        await delay(25);
        await vscode.commands.executeCommand('list.collapseAllToFocus');
        await delay(15);
        await vscode.commands.executeCommand('list.collapse');
      } else {
        for (const f of await collectDirs(dir)) {
          await vscode.commands.executeCommand('revealInExplorer', f);
          await delay(15);
          await vscode.commands.executeCommand('list.expand');
        }
      }
    }
  } finally {
    busy = false;
  }
}

async function getTarget(): Promise<vscode.Uri | undefined> {
  let clip: string | undefined;
  try {
    clip = await vscode.env.clipboard.readText();
    await vscode.commands.executeCommand('copyFilePath');
    const copied = (await vscode.env.clipboard.readText()).trim().split(/\r?\n/)[0];

    if (copied && copied !== clip) {
      const dir = await toDir(vscode.Uri.file(copied));
      if (dir) return dir;
    }
  } catch {
    // Clipboard unavailable
  } finally {
    if (clip !== undefined) void vscode.env.clipboard.writeText(clip);
  }

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === 'file') return toDir(active);

  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function toDir(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.Directory) !== 0 ? uri : vscode.Uri.joinPath(uri, '..');
  } catch {
    return undefined;
  }
}

async function collectDirs(root: vscode.Uri, max = 150): Promise<vscode.Uri[]> {
  const res: vscode.Uri[] = [root];
  const q: vscode.Uri[] = [root];
  const seen = new Set<string>([root.fsPath]);

  while (q.length > 0 && res.length < max) {
    const curr = q.shift()!;
    try {
      const entries = await vscode.workspace.fs.readDirectory(curr);
      for (const [name, type] of entries) {
        if (res.length >= max) break;
        if (!(type & vscode.FileType.Directory) || name.startsWith('.') || IGNORED.has(name)) continue;

        const child = vscode.Uri.joinPath(curr, name);
        if (!seen.has(child.fsPath)) {
          seen.add(child.fsPath);
          res.push(child);
          q.push(child);
        }
      }
    } catch {
      // Inaccessible dir
    }
  }
  return res;
}

export function deactivate() {
  busy = false;
}