import * as vscode from 'vscode';
import { ConnectionManager } from '../connections/ConnectionManager';
import { DBConnection, ColumnInfo } from '../connections/types';

export type TreeItemType = 'connection' | 'table' | 'column';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly itemType: TreeItemType,
    public readonly connectionId: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly tableName?: string,
    public readonly columnInfo?: ColumnInfo,
    public readonly dbConnection?: DBConnection
  ) {
    super(label, collapsibleState);
  }
}

export class ConnectionProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly connectionManager: ConnectionManager) {
    connectionManager.onDidChangeConnections(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (!element) {
      return this.getConnectionItems();
    }

    if (element.itemType === 'connection') {
      return this.getTableItems(element.connectionId);
    }

    if (element.itemType === 'table' && element.tableName) {
      return this.getColumnItems(element.connectionId, element.tableName);
    }

    return [];
  }

  private getConnectionItems(): ConnectionTreeItem[] {
    const connections = this.connectionManager.getAllConnections();
    return connections.map(conn => {
      const isConnected = this.connectionManager.isConnected(conn.id);
      const item = new ConnectionTreeItem(
        'connection',
        conn.id,
        conn.name,
        isConnected
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        undefined,
        conn
      );

      const typeIcon: Record<string, string> = {
        postgresql: 'database',
        mysql: 'database',
        sqlite: 'file',
      };

      item.iconPath = new vscode.ThemeIcon(
        typeIcon[conn.type] || 'database',
        isConnected
          ? new vscode.ThemeColor('charts.green')
          : undefined
      );
      item.contextValue = isConnected ? 'connection-connected' : 'connection-disconnected';
      item.description = `${conn.type}${isConnected ? ' (connected)' : ''}`;
      item.tooltip = `${conn.name}\nType: ${conn.type}\n${
        conn.type === 'sqlite'
          ? `File: ${conn.filePath || conn.database}`
          : `Host: ${conn.host || 'localhost'}:${conn.port || (conn.type === 'postgresql' ? 5432 : 3306)}\nDatabase: ${conn.database}`
      }`;
      return item;
    });
  }

  private async getTableItems(connectionId: string): Promise<ConnectionTreeItem[]> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) {
      const item = new ConnectionTreeItem(
        'table',
        connectionId,
        'Not connected — click to connect',
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('warning');
      item.command = {
        command: 'dblens.connectDatabase',
        title: 'Connect',
        arguments: [new ConnectionTreeItem('connection', connectionId, '', vscode.TreeItemCollapsibleState.None)],
      };
      return [item];
    }

    try {
      const tables = await client.getTables();
      if (tables.length === 0) {
        const item = new ConnectionTreeItem(
          'table',
          connectionId,
          'No tables found',
          vscode.TreeItemCollapsibleState.None
        );
        item.iconPath = new vscode.ThemeIcon('info');
        return [item];
      }

      return tables.map(tableName => {
        const item = new ConnectionTreeItem(
          'table',
          connectionId,
          tableName,
          vscode.TreeItemCollapsibleState.Collapsed,
          tableName
        );
        item.iconPath = new vscode.ThemeIcon('symbol-class');
        item.contextValue = 'table';
        item.tooltip = `Table: ${tableName}\nDouble-click to view data`;
        item.command = {
          command: 'dblens.viewTable',
          title: 'View Table',
          arguments: [item],
        };
        return item;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const item = new ConnectionTreeItem(
        'table',
        connectionId,
        `Error: ${message}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('error');
      return [item];
    }
  }

  private async getColumnItems(connectionId: string, tableName: string): Promise<ConnectionTreeItem[]> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) {
      return [];
    }

    try {
      const columns = await client.getColumns(tableName);
      return columns.map(col => {
        const label = `${col.name}: ${col.type}`;
        const item = new ConnectionTreeItem(
          'column',
          connectionId,
          label,
          vscode.TreeItemCollapsibleState.None,
          tableName,
          col
        );

        if (col.isPrimaryKey) {
          item.iconPath = new vscode.ThemeIcon('key', new vscode.ThemeColor('charts.yellow'));
          item.description = 'PK';
        } else {
          item.iconPath = new vscode.ThemeIcon('symbol-field');
        }

        const nullable = col.nullable ? 'NULL' : 'NOT NULL';
        const def = col.defaultValue ? `DEFAULT ${col.defaultValue}` : '';
        item.tooltip = `${col.name} ${col.type} ${nullable} ${def}`.trim();
        item.contextValue = 'column';
        return item;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const item = new ConnectionTreeItem(
        'column',
        connectionId,
        `Error: ${message}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('error');
      return [item];
    }
  }
}
