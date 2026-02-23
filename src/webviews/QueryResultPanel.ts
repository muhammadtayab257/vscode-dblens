import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connections/ConnectionManager';

export class QueryResultPanel {
  private static instance: QueryResultPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
  }

  static show(
    connectionManager: ConnectionManager,
    extensionUri: vscode.Uri
  ): QueryResultPanel {
    if (QueryResultPanel.instance && !QueryResultPanel.instance.disposed) {
      QueryResultPanel.instance.panel.reveal(vscode.ViewColumn.Two);
      return QueryResultPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.queryResult',
      'Query Results',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    QueryResultPanel.instance = new QueryResultPanel(panel, connectionManager, extensionUri);
    return QueryResultPanel.instance;
  }

  async runQuery(connectionId: string, sql: string): Promise<void> {
    let client = this.connectionManager.getClient(connectionId);

    // If connection was lost, try to reconnect once
    if (!client) {
      try {
        await this.connectionManager.reconnect(connectionId);
        client = this.connectionManager.getClient(connectionId);
      } catch {
        // Reconnect failed
      }
    }

    if (!client) {
      this.panel.webview.postMessage({
        type: 'error',
        message: 'Connection lost. Please reconnect from the sidebar.',
      });
      return;
    }

    this.panel.webview.postMessage({ type: 'loading', sql });

    const result = await client.executeQuery(sql);

    if (result.error) {
      this.panel.webview.postMessage({
        type: 'queryError',
        error: result.error,
        sql,
        executionTimeMs: result.executionTimeMs,
      });
    } else {
      this.panel.webview.postMessage({
        type: 'queryResult',
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
        sql,
      });
    }
  }

  private async handleMessage(msg: { type: string; columns?: string[]; rows?: Record<string, unknown>[] }): Promise<void> {
    switch (msg.type) {
      case 'export':
        await this.exportCSV(msg.columns || [], msg.rows || []);
        break;
    }
  }

  private async exportCSV(columns: string[], rows: Record<string, unknown>[]): Promise<void> {
    const csvLines: string[] = [];
    csvLines.push(columns.map(c => `"${c.replace(/"/g, '""')}"`).join(','));
    for (const row of rows) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) {
          return '';
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvLines.push(values.join(','));
    }

    const csv = csvLines.join('\n');
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('query_result.csv'),
      filters: { 'CSV Files': ['csv'] },
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
      vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
    }
  }

  private getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'queryResult.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return '<!DOCTYPE html><html><body><p>Error loading query results panel.</p></body></html>';
    }
  }

  private dispose(): void {
    this.disposed = true;
    QueryResultPanel.instance = undefined;
  }
}
