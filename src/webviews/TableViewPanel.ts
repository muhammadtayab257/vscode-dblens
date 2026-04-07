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
  private primaryKeys: string[] = [];
  private foreignKeys: { fromColumn: string; toTable: string; toColumn: string }[] = [];

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
      // Fetch primary keys and foreign keys
      if (this.primaryKeys.length === 0) {
        try {
          this.primaryKeys = await client.getPrimaryKeys(this.tableName);
        } catch { /* no PK support */ }
      }
      if (this.foreignKeys.length === 0) {
        try {
          const allFks = await client.getForeignKeys();
          this.foreignKeys = allFks
            .filter(fk => fk.fromTable === this.tableName)
            .map(fk => ({ fromColumn: fk.fromColumn, toTable: fk.toTable, toColumn: fk.toColumn }));
        } catch { /* no FK support */ }
      }

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
        primaryKeys: this.primaryKeys,
        foreignKeys: this.foreignKeys,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message });
    }
  }

  private async handleMessage(msg: {
    type: string;
    page?: number;
    column?: string;
    filter?: string;
    format?: string;
    changes?: { type: string; pkValues?: Record<string, unknown>; column?: string; value?: unknown; row?: Record<string, unknown> }[];
  }): Promise<void> {
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
      case 'saveChanges':
        await this.saveChanges(msg.changes || []);
        break;
      case 'navigateFK': {
        const toTable = (msg as { type: string; toTable?: string; toColumn?: string; value?: unknown }).toTable;
        const toColumn = (msg as { type: string; toTable?: string; toColumn?: string; value?: unknown }).toColumn;
        const value = (msg as { type: string; toTable?: string; toColumn?: string; value?: unknown }).value;
        if (toTable && toColumn && value !== undefined) {
          const panel = TableViewPanel.show(this.connectionManager, this.connectionId, toTable, this.extensionUri);
          // Set filter to the FK value
          const conn = this.connectionManager.getConnection(this.connectionId);
          const q = conn?.type === 'mysql' ? '`' : '"';
          panel.filter = `${q}${toColumn}${q} = '${String(value).replace(/'/g, "''")}'`;
          panel.currentPage = 0;
          panel.loadData();
        }
        break;
      }
    }
  }

  private async saveChanges(changes: { type: string; pkValues?: Record<string, unknown>; column?: string; value?: unknown; row?: Record<string, unknown> }[]): Promise<void> {
    const client = this.connectionManager.getClient(this.connectionId);
    if (!client) {
      this.panel.webview.postMessage({ type: 'saveResult', success: false, error: 'Connection lost.' });
      return;
    }

    const conn = this.connectionManager.getConnection(this.connectionId);
    const dbType = conn?.type || 'postgresql';
    const q = dbType === 'mysql' ? '`' : '"';
    const tbl = `${q}${this.tableName}${q}`;

    const errors: string[] = [];
    let successCount = 0;

    for (const change of changes) {
      try {
        if (change.type === 'update' && change.pkValues && change.column !== undefined) {
          const whereClause = this.buildWhereClause(change.pkValues, q, dbType);
          const val = change.value === null || change.value === '' ? 'NULL' : `'${String(change.value).replace(/'/g, "''")}'`;
          const sql = `UPDATE ${tbl} SET ${q}${change.column}${q} = ${val} WHERE ${whereClause}`;
          const result = await client.executeQuery(sql);
          if (result.error) { errors.push(`UPDATE ${change.column}: ${result.error}`); }
          else { successCount++; }
        } else if (change.type === 'delete' && change.pkValues) {
          const whereClause = this.buildWhereClause(change.pkValues, q, dbType);
          const sql = `DELETE FROM ${tbl} WHERE ${whereClause}`;
          const result = await client.executeQuery(sql);
          if (result.error) { errors.push(`DELETE: ${result.error}`); }
          else { successCount++; }
        } else if (change.type === 'insert' && change.row) {
          const cols = Object.keys(change.row).filter(k => change.row![k] !== undefined && change.row![k] !== '');
          if (cols.length === 0) { continue; }
          const colNames = cols.map(c => `${q}${c}${q}`).join(', ');
          const values = cols.map(c => {
            const v = change.row![c];
            if (v === null) { return 'NULL'; }
            return `'${String(v).replace(/'/g, "''")}'`;
          }).join(', ');
          const sql = `INSERT INTO ${tbl} (${colNames}) VALUES (${values})`;
          const result = await client.executeQuery(sql);
          if (result.error) { errors.push(`INSERT: ${result.error}`); }
          else { successCount++; }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
      }
    }

    if (errors.length > 0) {
      this.panel.webview.postMessage({ type: 'saveResult', success: false, error: errors.join('\n'), successCount });
    } else {
      this.panel.webview.postMessage({ type: 'saveResult', success: true, successCount });
    }

    // Reload data after changes
    await this.loadData();
  }

  private buildWhereClause(pkValues: Record<string, unknown>, q: string, dbType: string): string {
    return Object.entries(pkValues).map(([col, val]) => {
      if (val === null || val === undefined) { return `${q}${col}${q} IS NULL`; }
      return `${q}${col}${q} = '${String(val).replace(/'/g, "''")}'`;
    }).join(' AND ');
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
