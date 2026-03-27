import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connections/ConnectionManager';

export class ERDPanel {
  private static panels: Map<string, ERDPanel> = new Map();
  private panel: vscode.WebviewPanel;
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    private readonly connId: string,
    private readonly connName: string,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
  }

  static show(
    connectionManager: ConnectionManager,
    connId: string,
    connName: string,
    extensionUri: vscode.Uri
  ): ERDPanel {
    const existing = ERDPanel.panels.get(connId);
    if (existing && !existing.disposed) {
      existing.panel.reveal();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.erd',
      `ER Diagram: ${connName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    panel.iconPath = new vscode.ThemeIcon('type-hierarchy');

    const instance = new ERDPanel(panel, connectionManager, connId, connName, extensionUri);
    ERDPanel.panels.set(connId, instance);
    return instance;
  }

  private async handleMessage(msg: { type: string }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.loadSchema();
        break;

      case 'refresh':
        await this.loadSchema();
        break;

      case 'openTable': {
        const tableName = (msg as { type: string; table: string }).table;
        if (tableName) {
          vscode.commands.executeCommand('dblens.viewTable', {
            connectionId: this.connId,
            tableName,
          });
        }
        break;
      }

      case 'exportPng':
      case 'exportSvg': {
        const data = (msg as { type: string; data: string }).data;
        const ext = msg.type === 'exportPng' ? 'png' : 'svg';
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`erd_${this.connName}.${ext}`),
          filters: ext === 'png'
            ? { 'PNG Image': ['png'] }
            : { 'SVG Image': ['svg'] },
        });
        if (uri) {
          if (ext === 'png') {
            const base64 = data.replace(/^data:image\/png;base64,/, '');
            await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, 'base64'));
          } else {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf-8'));
          }
          vscode.window.showInformationMessage(`ER Diagram exported to ${uri.fsPath}`);
        }
        break;
      }
    }
  }

  private async loadSchema(): Promise<void> {
    const client = this.connectionManager.getClient(this.connId);
    if (!client) {
      this.panel.webview.postMessage({ type: 'error', message: 'Not connected.' });
      return;
    }

    this.panel.webview.postMessage({ type: 'loading' });

    try {
      const [tables, allColumns, foreignKeys] = await Promise.all([
        client.getTables(),
        client.getAllColumns(),
        client.getForeignKeys(),
      ]);

      this.panel.webview.postMessage({
        type: 'schema',
        tables,
        columns: allColumns,
        foreignKeys,
        connName: this.connName,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message });
    }
  }

  private getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'erd.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return '<!DOCTYPE html><html><body><p>Error loading ER Diagram.</p></body></html>';
    }
  }

  private dispose(): void {
    this.disposed = true;
    ERDPanel.panels.delete(this.connId);
  }
}
