import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SchemaProvider } from '../providers/SchemaProvider';
import { autoLayoutTables } from '../utils/layout';

export class SchemaPanel {
  private static panels = new Map<string, SchemaPanel>();
  private panel: vscode.WebviewPanel;
  private disposed = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly schemaProvider: SchemaProvider,
    private readonly connectionId: string,
    private readonly connectionName: string,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());

    this.loadSchema();
  }

  static show(
    schemaProvider: SchemaProvider,
    connectionId: string,
    connectionName: string,
    extensionUri: vscode.Uri
  ): SchemaPanel {
    const existing = SchemaPanel.panels.get(connectionId);
    if (existing && !existing.disposed) {
      existing.panel.reveal();
      existing.loadSchema();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'dblens.schema',
      `Schema: ${connectionName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webviews', 'html')],
      }
    );

    const instance = new SchemaPanel(panel, schemaProvider, connectionId, connectionName, extensionUri);
    SchemaPanel.panels.set(connectionId, instance);
    return instance;
  }

  private async loadSchema(): Promise<void> {
    try {
      const schema = await this.schemaProvider.getSchema(this.connectionId);
      const positions = autoLayoutTables(schema.tables, schema.foreignKeys);

      this.panel.webview.postMessage({
        type: 'schema',
        tables: schema.tables,
        foreignKeys: schema.foreignKeys,
        positions,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message });
    }
  }

  private getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'webviews', 'html', 'schema.html');
    try {
      return fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return '<!DOCTYPE html><html><body><p>Error loading schema visualizer.</p></body></html>';
    }
  }

  private dispose(): void {
    this.disposed = true;
    SchemaPanel.panels.delete(this.connectionId);
  }
}
