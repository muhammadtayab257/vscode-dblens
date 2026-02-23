import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ConnectionManager } from '../connections/ConnectionManager';
import { DBConnection } from '../connections/types';

export class ConnectionFormPanel {
  private static instance: ConnectionFormPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private onSaved?: (connId: string) => void;

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

  static showNew(
    connectionManager: ConnectionManager,
    extensionUri: vscode.Uri,
    onSaved?: (connId: string) => void
  ): ConnectionFormPanel {
    if (ConnectionFormPanel.instance && !ConnectionFormPanel.instance.disposed) {
      ConnectionFormPanel.instance.panel.reveal();
      ConnectionFormPanel.instance.onSaved = onSaved;
      return ConnectionFormPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.connectionForm',
      'New Connection',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    const instance = new ConnectionFormPanel(panel, connectionManager, extensionUri);
    instance.onSaved = onSaved;
    ConnectionFormPanel.instance = instance;
    return instance;
  }

  static showEdit(
    connectionManager: ConnectionManager,
    extensionUri: vscode.Uri,
    connection: DBConnection,
    onSaved?: (connId: string) => void
  ): ConnectionFormPanel {
    if (ConnectionFormPanel.instance && !ConnectionFormPanel.instance.disposed) {
      ConnectionFormPanel.instance.panel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.connectionForm',
      `Edit: ${connection.name}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    const instance = new ConnectionFormPanel(panel, connectionManager, extensionUri);
    instance.onSaved = onSaved;
    ConnectionFormPanel.instance = instance;

    // Send connection data to populate the form
    setTimeout(() => {
      panel.webview.postMessage({
        type: 'populate',
        data: {
          id: connection.id,
          name: connection.name,
          type: connection.type,
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          filePath: connection.filePath,
        },
      });
    }, 100);

    return instance;
  }

  private async handleMessage(msg: { type: string; data?: Record<string, unknown> }): Promise<void> {
    switch (msg.type) {
      case 'browse':
        await this.handleBrowse();
        break;
      case 'test':
        await this.handleTest(msg.data);
        break;
      case 'save':
        await this.handleSave(msg.data);
        break;
    }
  }

  private async handleBrowse(): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'SQLite Database': ['db', 'sqlite', 'sqlite3', 'db3'] },
      title: 'Select SQLite database file',
    });

    if (fileUri && fileUri.length > 0) {
      this.panel.webview.postMessage({
        type: 'filePicked',
        path: fileUri[0].fsPath,
      });
    }
  }

  private async handleTest(data: Record<string, unknown> | undefined): Promise<void> {
    if (!data) { return; }

    const conn = this.buildConnection(data);
    const password = data.password as string | undefined;

    try {
      const message = await this.connectionManager.testConnection(conn, password);
      this.panel.webview.postMessage({
        type: 'testResult',
        success: true,
        message,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({
        type: 'testResult',
        success: false,
        message,
      });
    }
  }

  private async handleSave(data: Record<string, unknown> | undefined): Promise<void> {
    if (!data) { return; }

    const isEdit = !!data.id;
    const conn = this.buildConnection(data);
    const password = data.password as string | undefined;

    try {
      if (isEdit) {
        await this.connectionManager.updateConnection(conn, password);
        // Disconnect if connected so it reconnects with new settings
        await this.connectionManager.disconnect(conn.id);
      } else {
        await this.connectionManager.addConnection(conn, password);
      }

      // Auto-connect
      try {
        await this.connectionManager.connect(conn.id);
      } catch {
        // Saved but couldn't auto-connect
      }

      this.panel.webview.postMessage({
        type: 'saveResult',
        success: true,
        message: isEdit ? 'Connection updated and connected!' : 'Connection saved and connected!',
      });

      this.onSaved?.(conn.id);

      // Close the form after a brief delay so user sees the success message
      setTimeout(() => {
        if (!this.disposed) {
          this.panel.dispose();
        }
      }, 800);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({
        type: 'saveResult',
        success: false,
        message,
      });
    }
  }

  private buildConnection(data: Record<string, unknown>): DBConnection {
    const id = (data.id as string) || crypto.randomUUID();
    const type = data.type as 'postgresql' | 'mysql' | 'sqlite';

    const conn: DBConnection = {
      id,
      name: (data.name as string) || 'Unnamed',
      type,
      database: (data.database as string) || '',
    };

    if (type === 'sqlite') {
      conn.filePath = (data.filePath as string) || (data.database as string) || '';
      conn.database = conn.filePath;
    } else {
      conn.host = (data.host as string) || 'localhost';
      conn.port = (data.port as number) || (type === 'postgresql' ? 5432 : 3306);
      conn.username = (data.username as string) || undefined;
    }

    return conn;
  }

  private getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'connectionForm.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return '<!DOCTYPE html><html><body><p>Error loading connection form.</p></body></html>';
    }
  }

  private dispose(): void {
    this.disposed = true;
    ConnectionFormPanel.instance = undefined;
  }
}
