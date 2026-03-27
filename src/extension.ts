import * as vscode from 'vscode';
import { ConnectionManager } from './connections/ConnectionManager';
import { ConnectionProvider, ConnectionTreeItem } from './providers/ConnectionProvider';
import { TableViewPanel } from './webviews/TableViewPanel';
import { QueryResultPanel } from './webviews/QueryResultPanel';
import { ConnectionFormPanel } from './webviews/ConnectionFormPanel';
import { QueryEditorPanel } from './webviews/QueryEditorPanel';

let connectionManager: ConnectionManager;
let connectionProvider: ConnectionProvider;
let activeConnectionId: string | undefined;

class QuickActionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItems(): vscode.TreeItem[] {
    const queryItem = new vscode.TreeItem('Open Query Editor', vscode.TreeItemCollapsibleState.None);
    queryItem.command = { command: 'dblens.openQueryEditor', title: 'Open Query Editor', arguments: [] };
    queryItem.iconPath = new vscode.ThemeIcon('terminal');
    queryItem.tooltip = 'Open the SQL query editor panel';

    const addItem = new vscode.TreeItem('Add Connection', vscode.TreeItemCollapsibleState.None);
    addItem.command = { command: 'dblens.addConnection', title: 'Add Connection', arguments: [] };
    addItem.iconPath = new vscode.ThemeIcon('add');
    addItem.tooltip = 'Add a new database connection';

    const refreshItem = new vscode.TreeItem('Refresh Connections', vscode.TreeItemCollapsibleState.None);
    refreshItem.command = { command: 'dblens.refreshConnections', title: 'Refresh', arguments: [] };
    refreshItem.iconPath = new vscode.ThemeIcon('refresh');
    refreshItem.tooltip = 'Refresh the connections list';

    return [queryItem, addItem, refreshItem];
  }

  getTreeChildren(): vscode.TreeItem[] { return []; }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    return element ? [] : this.getTreeItems();
  }
}

export function activate(context: vscode.ExtensionContext) {
  connectionManager = new ConnectionManager(context);
  connectionProvider = new ConnectionProvider(connectionManager);

  // Register TreeView
  const treeView = vscode.window.createTreeView('dblens-connections', {
    treeDataProvider: connectionProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Register Quick Actions view (static tree with labeled actions)
  const quickActionsProvider = new QuickActionsProvider();
  const quickActionsView = vscode.window.createTreeView('dblens-quickactions', {
    treeDataProvider: quickActionsProvider,
  });
  context.subscriptions.push(quickActionsView);

  // Register all commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dblens.addConnection', () => addConnection(context)),
    vscode.commands.registerCommand('dblens.editConnection', (item: ConnectionTreeItem) => editConnection(context, item)),
    vscode.commands.registerCommand('dblens.removeConnection', (item: ConnectionTreeItem) => removeConnection(item)),
    vscode.commands.registerCommand('dblens.refreshConnections', () => connectionProvider.refresh()),
    vscode.commands.registerCommand('dblens.connectDatabase', (item: ConnectionTreeItem) => connectDatabase(item)),
    vscode.commands.registerCommand('dblens.disconnectDatabase', (item: ConnectionTreeItem) => disconnectDatabase(item)),
    vscode.commands.registerCommand('dblens.runQuery', () => runQuery(context)),
    vscode.commands.registerCommand('dblens.viewTable', (item: ConnectionTreeItem) => viewTable(context, item)),

    vscode.commands.registerCommand('dblens.exportCSV', () => exportCSV(context)),
    vscode.commands.registerCommand('dblens.copyTableName', (item: ConnectionTreeItem) => copyTableName(item)),
    vscode.commands.registerCommand('dblens.openQueryEditor', () => openQueryEditor(context)),
  );
}

export function deactivate() {
  connectionManager?.disposeAll();
}

// ─── Add Connection ───────────────────────────────────────────────

function addConnection(context: vscode.ExtensionContext): void {
  ConnectionFormPanel.showNew(connectionManager, context.extensionUri, (connId) => {
    activeConnectionId = connId;
  });
}

// ─── Edit Connection ──────────────────────────────────────────────

function editConnection(context: vscode.ExtensionContext, item: ConnectionTreeItem): void {
  const conn = connectionManager.getConnection(item.connectionId);
  if (!conn) {
    vscode.window.showErrorMessage('Connection not found.');
    return;
  }

  ConnectionFormPanel.showEdit(connectionManager, context.extensionUri, conn, (connId) => {
    activeConnectionId = connId;
  });
}

// ─── Remove Connection ────────────────────────────────────────────

async function removeConnection(item: ConnectionTreeItem): Promise<void> {
  const conn = connectionManager.getConnection(item.connectionId);
  if (!conn) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Remove connection "${conn.name}"?`,
    { modal: true },
    'Remove'
  );
  if (confirm !== 'Remove') {
    return;
  }

  await connectionManager.removeConnection(conn.id);
  vscode.window.showInformationMessage(`Connection "${conn.name}" removed.`);
}

// ─── Connect / Disconnect ─────────────────────────────────────────

async function connectDatabase(item: ConnectionTreeItem): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Connecting to ${item.label}...` },
      async () => {
        await connectionManager.connect(item.connectionId);
      }
    );
    activeConnectionId = item.connectionId;
    vscode.window.showInformationMessage(`Connected to ${item.label}.`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Connection failed: ${message}`);
  }
}

async function disconnectDatabase(item: ConnectionTreeItem): Promise<void> {
  await connectionManager.disconnect(item.connectionId);
  if (activeConnectionId === item.connectionId) {
    activeConnectionId = undefined;
  }
  vscode.window.showInformationMessage(`Disconnected from ${item.label}.`);
}

// ─── Run Query ────────────────────────────────────────────────────

async function runQuery(context: vscode.ExtensionContext): Promise<void> {
  let sql: string | undefined;

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    sql = selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(selection);
  }

  // If no editor or empty text, open a quick input
  if (!sql?.trim()) {
    sql = await vscode.window.showInputBox({
      prompt: 'Enter SQL query to execute',
      placeHolder: 'SELECT * FROM table_name LIMIT 50;',
      ignoreFocusOut: true,
    });
  }

  if (!sql?.trim()) {
    return;
  }

  const connId = await pickConnection();
  if (!connId) {
    return;
  }

  const panel = QueryResultPanel.show(connectionManager, context.extensionUri);
  await panel.runQuery(connId, sql.trim());
}

function openQueryEditor(context: vscode.ExtensionContext): void {
  QueryEditorPanel.show(connectionManager, context.extensionUri);
}

// ─── View Table ───────────────────────────────────────────────────

async function viewTable(context: vscode.ExtensionContext, item: ConnectionTreeItem): Promise<void> {
  if (!item.tableName) {
    return;
  }

  // Ensure connected
  if (!connectionManager.isConnected(item.connectionId)) {
    try {
      await connectionManager.connect(item.connectionId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Cannot connect: ${message}`);
      return;
    }
  }

  TableViewPanel.show(connectionManager, item.connectionId, item.tableName, context.extensionUri);
}

// ─── Export CSV ───────────────────────────────────────────────────

async function exportCSV(context: vscode.ExtensionContext): Promise<void> {
  const connId = await pickConnection();
  if (!connId) {
    return;
  }

  const client = connectionManager.getClient(connId);
  if (!client) {
    vscode.window.showErrorMessage('Not connected.');
    return;
  }

  const tables = await client.getTables();
  const table = await vscode.window.showQuickPick(tables, {
    placeHolder: 'Select a table to export',
  });
  if (!table) {
    return;
  }

  const panel = TableViewPanel.show(connectionManager, connId, table, context.extensionUri);
  await panel.exportCSV();
}

// ─── Copy Table Name ──────────────────────────────────────────────

async function copyTableName(item: ConnectionTreeItem): Promise<void> {
  if (item.tableName) {
    await vscode.env.clipboard.writeText(item.tableName);
    vscode.window.showInformationMessage(`Copied "${item.tableName}" to clipboard.`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

async function pickConnection(): Promise<string | undefined> {
  const connections = connectionManager.getAllConnections();
  const connected = connections.filter(c => connectionManager.isConnected(c.id));

  if (connected.length === 1) {
    return connected[0].id;
  }

  if (connected.length === 0) {
    // Try to connect to one
    if (connections.length === 0) {
      vscode.window.showErrorMessage('No connections configured. Use "DBLens: Add Connection" first.');
      return undefined;
    }

    const pick = await vscode.window.showQuickPick(
      connections.map(c => ({ label: c.name, description: `${c.type} — ${c.host || c.filePath || c.database}`, id: c.id })),
      { placeHolder: 'Select a connection to use' }
    );
    if (!pick) {
      return undefined;
    }

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Connecting to ${pick.label}...` },
        async () => {
          await connectionManager.connect(pick.id);
        }
      );
      activeConnectionId = pick.id;
      return pick.id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Connection failed: ${message}`);
      return undefined;
    }
  }

  // Multiple connected — let user pick
  const pick = await vscode.window.showQuickPick(
    connected.map(c => ({ label: c.name, description: `${c.type} (connected)`, id: c.id })),
    { placeHolder: 'Select which connection to use' }
  );
  return pick?.id;
}
