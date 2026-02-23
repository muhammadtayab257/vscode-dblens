import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connections/ConnectionManager';

const PAGE_SIZE = 50;

export class TableViewPanel {
  private static panels = new Map<string, TableViewPanel>();
  private panel: vscode.WebviewPanel;
  private connectionId: string;
  private tableName: string;
  private currentPage = 0;
  private sortColumn?: string;
  private sortDirection: 'ASC' | 'DESC' = 'ASC';
  private filter?: string;
  private totalRows = 0;
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    connectionId: string,
    tableName: string,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.connectionId = connectionId;
    this.tableName = tableName;

    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    this.loadData();
  }

  static show(
    connectionManager: ConnectionManager,
    connectionId: string,
    tableName: string,
    extensionUri: vscode.Uri
  ): TableViewPanel {
    const key = `${connectionId}:${tableName}`;
    const existing = TableViewPanel.panels.get(key);
    if (existing && !existing.disposed) {
      existing.panel.reveal();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.tableView',
      `Table: ${tableName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    const instance = new TableViewPanel(panel, connectionManager, connectionId, tableName, extensionUri);
    TableViewPanel.panels.set(key, instance);
    return instance;
  }

  private async loadData(): Promise<void> {
    let client = this.connectionManager.getClient(this.connectionId);

    // If connection was lost, try to reconnect once
    if (!client) {
      try {
        await this.connectionManager.reconnect(this.connectionId);
        client = this.connectionManager.getClient(this.connectionId);
      } catch {
        // Reconnect failed
      }
    }

    if (!client) {
      this.panel.webview.postMessage({ type: 'error', message: 'Connection lost. Please reconnect from the sidebar and refresh.' });
      return;
    }

    try {
      this.totalRows = await client.getTableRowCount(this.tableName);
      const result = await client.getTableData(
        this.tableName,
        PAGE_SIZE,
        this.currentPage * PAGE_SIZE,
        this.sortColumn,
        this.sortDirection,
        this.filter
      );

      if (result.error) {
        this.panel.webview.postMessage({ type: 'error', message: result.error });
        return;
      }

      this.panel.webview.postMessage({
        type: 'data',
        columns: result.columns,
        rows: result.rows,
        totalRows: this.totalRows,
        page: this.currentPage,
        pageSize: PAGE_SIZE,
        totalPages: Math.ceil(this.totalRows / PAGE_SIZE),
        sortColumn: this.sortColumn,
        sortDirection: this.sortDirection,
        executionTimeMs: result.executionTimeMs,
        tableName: this.tableName,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message });
    }
  }

  private async handleMessage(msg: { type: string; page?: number; column?: string; filter?: string; format?: string }): Promise<void> {
    switch (msg.type) {
      case 'nextPage':
        if ((this.currentPage + 1) * PAGE_SIZE < this.totalRows) {
          this.currentPage++;
          await this.loadData();
        }
        break;
      case 'prevPage':
        if (this.currentPage > 0) {
          this.currentPage--;
          await this.loadData();
        }
        break;
      case 'goToPage':
        if (msg.page !== undefined && msg.page >= 0) {
          this.currentPage = msg.page;
          await this.loadData();
        }
        break;
      case 'sort':
        if (msg.column) {
          if (this.sortColumn === msg.column) {
            this.sortDirection = this.sortDirection === 'ASC' ? 'DESC' : 'ASC';
          } else {
            this.sortColumn = msg.column;
            this.sortDirection = 'ASC';
          }
          this.currentPage = 0;
          await this.loadData();
        }
        break;
      case 'filter':
        this.filter = msg.filter || undefined;
        this.currentPage = 0;
        await this.loadData();
        break;
      case 'refresh':
        await this.loadData();
        break;
      case 'export':
        await this.exportCSV();
        break;
    }
  }

  async exportCSV(): Promise<void> {
    const client = this.connectionManager.getClient(this.connectionId);
    if (!client) {
      return;
    }

    const result = await client.getTableData(this.tableName, 100000, 0, this.sortColumn, this.sortDirection, this.filter);
    if (result.error) {
      vscode.window.showErrorMessage(`Export failed: ${result.error}`);
      return;
    }

    const csvLines: string[] = [];
    csvLines.push(result.columns.map(c => `"${c.replace(/"/g, '""')}"`).join(','));
    for (const row of result.rows) {
      const values = result.columns.map(col => {
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
      defaultUri: vscode.Uri.file(`${this.tableName}.csv`),
      filters: { 'CSV Files': ['csv'] },
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
      vscode.window.showInformationMessage(`Exported ${result.rows.length} rows to ${uri.fsPath}`);
    }
  }

  private getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'tableView.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return this.getFallbackHtml();
    }
  }

  private getFallbackHtml(): string {
    return '<!DOCTYPE html><html><body><p>Error loading table view.</p></body></html>';
  }

  private dispose(): void {
    this.disposed = true;
    const key = `${this.connectionId}:${this.tableName}`;
    TableViewPanel.panels.delete(key);
  }
}
