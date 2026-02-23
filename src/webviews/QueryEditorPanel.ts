import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connections/ConnectionManager';

export class QueryEditorPanel {
  private static instance: QueryEditorPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private connectionListener: vscode.Disposable | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    // Listen for connection changes to refresh the dropdown
    this.connectionListener = connectionManager.onDidChangeConnections(() => {
      this.sendConnections();
    });
  }

  static show(
    connectionManager: ConnectionManager,
    extensionUri: vscode.Uri
  ): QueryEditorPanel {
    if (QueryEditorPanel.instance && !QueryEditorPanel.instance.disposed) {
      QueryEditorPanel.instance.panel.reveal();
      return QueryEditorPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.queryEditor',
      'SQL Editor',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    panel.iconPath = new vscode.ThemeIcon('edit');

    const instance = new QueryEditorPanel(panel, connectionManager, extensionUri);
    QueryEditorPanel.instance = instance;
    return instance;
  }

  private sendConnections(): void {
    if (this.disposed) { return; }

    const connections = this.connectionManager.getAllConnections();
    const connList = connections
      .filter(c => this.connectionManager.isConnected(c.id))
      .map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
      }));

    // Find the active/first connected
    let activeId: string | undefined;
    if (connList.length > 0) {
      activeId = connList[0].id;
    }

    this.panel.webview.postMessage({
      type: 'connections',
      connections: connList,
      activeId,
    });
  }

  private async handleMessage(msg: {
    type: string;
    connId?: string;
    sql?: string;
    columns?: string[];
    rows?: Record<string, unknown>[];
  }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendConnections();
        break;

      case 'runQuery':
        await this.executeQuery(msg.connId!, msg.sql!);
        break;

      case 'export':
        await this.exportCSV(msg.columns || [], msg.rows || []);
        break;

      case 'fetchSchema':
        await this.fetchSchema(msg.connId!);
        break;

      case 'noConnection': {
        // Try to help the user pick a connection
        const connections = this.connectionManager.getAllConnections();
        if (connections.length === 0) {
          vscode.window.showErrorMessage('No connections configured. Use "DBLens: Add Connection" first.');
        } else {
          const pick = await vscode.window.showQuickPick(
            connections.map(c => ({
              label: c.name,
              description: `${c.type} — ${c.host || c.filePath || c.database}`,
              id: c.id,
            })),
            { placeHolder: 'Select a connection to use' }
          );
          if (pick) {
            try {
              await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Connecting to ${pick.label}...` },
                async () => {
                  await this.connectionManager.connect(pick.id);
                }
              );
              this.sendConnections();
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`Connection failed: ${message}`);
            }
          }
        }
        break;
      }
    }
  }

  private async executeQuery(connId: string, sql: string): Promise<void> {
    let client = this.connectionManager.getClient(connId);

    // If connection was lost, try to reconnect once
    if (!client) {
      try {
        await this.connectionManager.reconnect(connId);
        client = this.connectionManager.getClient(connId);
      } catch {
        // Reconnect failed
      }
    }

    if (!client) {
      this.panel.webview.postMessage({
        type: 'queryError',
        error: 'Connection lost. Please reconnect from the sidebar.',
        sql,
      });
      this.sendConnections();
      return;
    }

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

  private async fetchSchema(connId: string): Promise<void> {
    const client = this.connectionManager.getClient(connId);
    if (!client) { return; }

    try {
      const tables = await client.getTables();
      const schema: { tables: string[]; columns: Record<string, string[]> } = {
        tables,
        columns: {},
      };

      // Fetch columns for each table (limit to first 50 tables for performance)
      const tablesToFetch = tables.slice(0, 50);
      for (const table of tablesToFetch) {
        try {
          const cols = await client.getColumns(table);
          schema.columns[table] = cols.map(c => c.name);
        } catch {
          // Skip tables we can't read
        }
      }

      this.panel.webview.postMessage({
        type: 'schema',
        schema,
      });
    } catch {
      // Silently fail - autocomplete is a nice-to-have
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
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'queryEditor.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return '<!DOCTYPE html><html><body><p>Error loading SQL editor.</p></body></html>';
    }
  }

  private dispose(): void {
    this.disposed = true;
    this.connectionListener?.dispose();
    QueryEditorPanel.instance = undefined;
  }
}
