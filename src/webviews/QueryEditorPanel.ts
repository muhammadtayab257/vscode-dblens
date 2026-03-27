import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connections/ConnectionManager';

export class QueryEditorPanel {
  private static instance: QueryEditorPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private connectionListener: vscode.Disposable | undefined;
  private schemaCache: Map<string, { tables: string[]; columns: Record<string, string[]>; schemaText: string }> = new Map();

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    // Listen for connection changes to refresh the dropdown and clear schema cache
    this.connectionListener = connectionManager.onDidChangeConnections(() => {
      this.schemaCache.clear();
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
    prompt?: string;
    provider?: string;
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

      case 'generateSQL':
        await this.generateSQL(msg.connId!, msg.prompt!, msg.provider || 'copilot');
        break;

      case 'openAiSettings':
        await this.openAiSettings();
        // After settings change, notify webview of key status
        this.sendOpenaiKeyStatus();
        break;

      case 'checkOpenaiKey':
        this.sendOpenaiKeyStatus();
        break;

      case 'openGetKey':
        vscode.env.openExternal(vscode.Uri.parse('https://platform.openai.com/api-keys'));
        break;

      case 'openGithub':
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/muhammadtayab257/vscode-dblens'));
        break;

      case 'saveOpenaiKey': {
        const key = (msg as { type: string; key?: string }).key || '';
        const cfg = vscode.workspace.getConfiguration('dblens');
        await cfg.update('openaiApiKey', key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('OpenAI API key saved!');
        this.sendOpenaiKeyStatus();
        break;
      }

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

      // If query modified schema (CREATE, ALTER, DROP), clear cache and refetch
      const ddlPattern = /^\s*(CREATE|ALTER|DROP|RENAME)\s/i;
      if (ddlPattern.test(sql)) {
        this.schemaCache.delete(connId);
        this.fetchSchema(connId);
      }
    }
  }

  private async fetchSchema(connId: string): Promise<void> {
    const client = this.connectionManager.getClient(connId);
    if (!client) { return; }

    // Clear AI schema cache so next AI query fetches fresh schema
    this.schemaCache.delete(connId);

    try {
      const tables = await client.getTables();

      // Fetch ALL columns in ONE query (not 50 separate queries)
      const allCols = await client.getAllColumns();

      // Build autocomplete schema
      const schema: { tables: string[]; columns: Record<string, string[]> } = { tables, columns: {} };
      const schemaLines: string[] = [];

      for (const table of tables) {
        const cols = allCols[table] || [];
        schema.columns[table] = cols.map(c => c.name);
        if (cols.length > 0) {
          const colDefs = cols.map(c => `  ${c.name} ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}`);
          schemaLines.push(`${table} (\n${colDefs.join(',\n')}\n)`);
        } else {
          schemaLines.push(table);
        }
      }

      this.panel.webview.postMessage({ type: 'schema', schema });

      // Cache AI schema (same data, zero extra DB calls)
      this.schemaCache.set(connId, { tables, columns: schema.columns, schemaText: schemaLines.join('\n\n') });
    } catch {
      // Silently fail - autocomplete is a nice-to-have
    }
  }

  private sendOpenaiKeyStatus(): void {
    const config = vscode.workspace.getConfiguration('dblens');
    const apiKey = config.get<string>('openaiApiKey', '');
    this.panel.webview.postMessage({ type: 'openaiKeyStatus', hasKey: !!apiKey });
  }

  private async generateSQL(connId: string, prompt: string, provider: string = 'copilot'): Promise<void> {
    const client = this.connectionManager.getClient(connId);
    if (!client) {
      this.panel.webview.postMessage({
        type: 'generateSQLError',
        error: 'Not connected. Please select a connection first.',
      });
      return;
    }

    try {
      // Use cached schema or fetch with single query
      let schemaContext: string;
      const cached = this.schemaCache.get(connId);
      if (cached) {
        schemaContext = cached.schemaText;
      } else {
        const tables = await client.getTables();
        const allCols = await client.getAllColumns();
        const columns: Record<string, string[]> = {};
        const schemaLines: string[] = [];

        for (const table of tables) {
          const cols = allCols[table] || [];
          columns[table] = cols.map(c => c.name);
          if (cols.length > 0) {
            const colDefs = cols.map(c => `  ${c.name} ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}`);
            schemaLines.push(`${table} (\n${colDefs.join(',\n')}\n)`);
          } else {
            schemaLines.push(table);
          }
        }
        schemaContext = schemaLines.join('\n\n');
        this.schemaCache.set(connId, { tables, columns, schemaText: schemaContext });
      }

      // Determine DB type
      const conn = this.connectionManager.getAllConnections().find(c => c.id === connId);
      const dbType = conn?.type || 'SQL';

      const systemPrompt =
        `You are a helpful SQL expert assistant for a ${dbType} database.\n\n` +
        `Database schema:\n${schemaContext}\n\n` +
        `User request: ${prompt}\n\n` +
        `Respond with a JSON object (no markdown, no code fences) in this exact format:\n` +
        `{"explanation": "your explanation here", "sql": "SQL QUERY HERE"}\n\n` +
        `Handle these 3 cases:\n` +
        `1. If the user wants DATA (e.g. "show top accounts", "get revenue") → provide explanation of the query + the SQL\n` +
        `2. If the user asks a DATABASE QUESTION that doesn't need SQL (e.g. "explain my database", "what tables do I have", "describe the schema") → provide a DETAILED explanation referencing actual table names, column names, and relationships from the schema above. Be specific — mention real table names and what they store.\n` +
        `3. If the request is NOT related to databases at all (e.g. "write a poem", "what's the weather") → respond with:\n` +
        `  {"explanation": "I can only help with database queries. Try asking something like 'show all accounts created today'", "sql": "", "notDb": true}\n\n` +
        `Rules:\n` +
        `- Use proper ${dbType} syntax with exact table/column names from the schema\n` +
        `- Add a LIMIT clause if the query could return many rows\n` +
        `- Return ONLY valid JSON, nothing else`;

      // Helper to parse the AI response
      const parseAiResponse = (raw: string, isFinal: boolean = false): { explanation: string; sql: string; notDb?: boolean } | null => {
        let cleaned = raw.trim();
        // Remove markdown fences if present
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        }
        try {
          const parsed = JSON.parse(cleaned);
          return {
            explanation: parsed.explanation || '',
            sql: (parsed.sql || '').trim(),
            notDb: !!parsed.notDb,
          };
        } catch {
          if (isFinal) {
            // Final attempt: if JSON parsing fails, treat the whole response as SQL
            if (cleaned.startsWith('```')) {
              cleaned = cleaned.replace(/^```(?:sql)?\n?/, '').replace(/\n?```$/, '').trim();
            }
            return { explanation: '', sql: cleaned };
          }
          // During streaming, return null to indicate incomplete JSON
          return null;
        }
      };

      if (provider === 'copilot') {
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
        let model = models[0];
        if (!model) {
          const allModels = await vscode.lm.selectChatModels();
          model = allModels[0];
        }

        if (!model) {
          this.panel.webview.postMessage({
            type: 'generateSQLError',
            error: 'GitHub Copilot not available. Install the GitHub Copilot extension, or switch to the OpenAI tab.',
          });
          return;
        }

        const messages = [vscode.LanguageModelChatMessage.User(systemPrompt)];
        const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

        this.panel.webview.postMessage({ type: 'generatedSQLStart' });
        let raw = '';
        for await (const chunk of response.text) {
          raw += chunk;
          const partial = parseAiResponse(raw);
          if (partial) {
            this.panel.webview.postMessage({ type: 'generatedSQLChunk', sql: partial.sql, explanation: partial.explanation });
          }
        }

        const result = parseAiResponse(raw, true)!;
        this.panel.webview.postMessage({
          type: 'generatedSQL',
          sql: result.sql,
          explanation: result.explanation,
          notDb: result.notDb,
        });
      }

      // OpenAI provider
      if (provider === 'openai') {
        const config = vscode.workspace.getConfiguration('dblens');
        const apiKey = config.get<string>('openaiApiKey', '');
        const openaiModel = config.get<string>('openaiModel', 'gpt-4o-mini');

        if (!apiKey) {
          this.panel.webview.postMessage({
            type: 'generateSQLError',
            error: 'OpenAI API key not set. Click the ⚙ icon to add your key.',
          });
          return;
        }

        this.panel.webview.postMessage({ type: 'generatedSQLStart' });

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            stream: true,
            messages: [
              { role: 'user', content: systemPrompt },
            ],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          this.panel.webview.postMessage({
            type: 'generateSQLError',
            error: `OpenAI API error (${res.status}): ${errBody}`,
          });
          return;
        }

        let raw = '';
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { break; }

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n').filter(l => l.startsWith('data: '));

            for (const line of lines) {
              const data = line.slice(6);
              if (data === '[DONE]') { break; }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  raw += content;
                  const partial = parseAiResponse(raw);
                  if (partial) {
                    this.panel.webview.postMessage({ type: 'generatedSQLChunk', sql: partial.sql, explanation: partial.explanation });
                  }
                }
              } catch { /* skip malformed chunks */ }
            }
          }
        }

        const result = parseAiResponse(raw, true)!;
        this.panel.webview.postMessage({
          type: 'generatedSQL',
          sql: result.sql,
          explanation: result.explanation,
          notDb: result.notDb,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({
        type: 'generateSQLError',
        error: message,
      });
    }
  }

  private async openAiSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('dblens');
    const currentKey = config.get<string>('openaiApiKey', '');

    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(key) Set OpenAI API Key', description: currentKey ? 'Key is configured ✓' : 'No key set', id: 'setKey' },
        { label: '$(settings-gear) Choose Model', description: config.get<string>('openaiModel', 'gpt-4o-mini'), id: 'setModel' },
        { label: '$(link-external) Get API Key', description: 'Opens platform.openai.com', id: 'getKey' },
      ],
      { placeHolder: 'AI Settings — Configure your OpenAI API key for unlimited AI SQL generation' }
    );

    if (!pick) { return; }

    if (pick.id === 'setKey') {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your OpenAI API key',
        placeHolder: 'sk-...',
        password: true,
        value: currentKey,
        ignoreFocusOut: true,
      });
      if (key !== undefined) {
        await config.update('openaiApiKey', key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(key ? 'OpenAI API key saved!' : 'OpenAI API key removed.');
      }
    } else if (pick.id === 'setModel') {
      const model = await vscode.window.showQuickPick(
        [
          { label: 'gpt-4o-mini', description: 'Fast & cheapest (~$0.01/query)' },
          { label: 'gpt-4o', description: 'Most capable (~$0.03/query)' },
          { label: 'gpt-3.5-turbo', description: 'Legacy, fast' },
        ],
        { placeHolder: 'Select OpenAI model' }
      );
      if (model) {
        await config.update('openaiModel', model.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${model.label}`);
      }
    } else if (pick.id === 'getKey') {
      vscode.env.openExternal(vscode.Uri.parse('https://platform.openai.com/api-keys'));
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
