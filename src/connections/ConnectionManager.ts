import * as vscode from 'vscode';
import { DBConnection, DatabaseClient } from './types';
import { PostgresClient } from './PostgresClient';
import { MySQLClient } from './MySQLClient';
import { SQLiteClient } from './SQLiteClient';

const CONNECTIONS_KEY = 'dblens.connections';

export class ConnectionManager {
  private connections: Map<string, DBConnection> = new Map();
  private activeClients: Map<string, DatabaseClient> = new Map();
  private secrets: vscode.SecretStorage;
  private globalState: vscode.Memento;

  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.globalState = context.globalState;
    this.loadConnections();
  }

  private loadConnections(): void {
    const stored = this.globalState.get<DBConnection[]>(CONNECTIONS_KEY, []);
    this.connections.clear();
    for (const conn of stored) {
      this.connections.set(conn.id, conn);
    }
  }

  private async saveConnections(): Promise<void> {
    const arr = Array.from(this.connections.values());
    await this.globalState.update(CONNECTIONS_KEY, arr);
    this._onDidChangeConnections.fire();
  }

  getAllConnections(): DBConnection[] {
    return Array.from(this.connections.values());
  }

  getConnection(id: string): DBConnection | undefined {
    return this.connections.get(id);
  }

  async addConnection(conn: DBConnection, password?: string): Promise<void> {
    this.connections.set(conn.id, conn);
    if (password) {
      await this.secrets.store(`dblens.password.${conn.id}`, password);
    }
    await this.saveConnections();
  }

  async updateConnection(conn: DBConnection, password?: string): Promise<void> {
    this.connections.set(conn.id, conn);
    if (password !== undefined) {
      if (password) {
        await this.secrets.store(`dblens.password.${conn.id}`, password);
      } else {
        await this.secrets.delete(`dblens.password.${conn.id}`);
      }
    }
    await this.saveConnections();
  }

  async removeConnection(id: string): Promise<void> {
    await this.disconnect(id);
    this.connections.delete(id);
    await this.secrets.delete(`dblens.password.${id}`);
    await this.saveConnections();
  }

  async getPassword(id: string): Promise<string | undefined> {
    return this.secrets.get(`dblens.password.${id}`);
  }

  async connect(id: string): Promise<DatabaseClient> {
    const existing = this.activeClients.get(id);
    if (existing?.isConnected()) {
      return existing;
    }

    const conn = this.connections.get(id);
    if (!conn) {
      throw new Error(`Connection "${id}" not found`);
    }

    const password = await this.getPassword(id);
    const client = this.createClient(conn, password);

    await client.connect();
    this.activeClients.set(id, client);
    this._onDidChangeConnections.fire();
    return client;
  }

  async disconnect(id: string): Promise<void> {
    const client = this.activeClients.get(id);
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.activeClients.delete(id);
      this._onDidChangeConnections.fire();
    }
  }

  getClient(id: string): DatabaseClient | undefined {
    const client = this.activeClients.get(id);
    if (client && !client.isConnected()) {
      // Connection was lost — clean up stale entry
      this.activeClients.delete(id);
      this._onDidChangeConnections.fire();
      return undefined;
    }
    return client;
  }

  isConnected(id: string): boolean {
    const client = this.activeClients.get(id);
    if (client && !client.isConnected()) {
      this.activeClients.delete(id);
      this._onDidChangeConnections.fire();
      return false;
    }
    return !!client;
  }

  async reconnect(id: string): Promise<DatabaseClient> {
    await this.disconnect(id);
    return this.connect(id);
  }

  async testConnection(conn: DBConnection, password?: string): Promise<string> {
    const client = this.createClient(conn, password);
    try {
      await client.connect();
      await client.disconnect();
      return 'Connection successful!';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Connection failed: ${message}`);
    }
  }

  private createClient(conn: DBConnection, password?: string): DatabaseClient {
    switch (conn.type) {
      case 'postgresql':
        return new PostgresClient(conn, password);
      case 'mysql':
        return new MySQLClient(conn, password);
      case 'sqlite':
        return new SQLiteClient(conn);
      default:
        throw new Error(`Unsupported database type: ${conn.type}`);
    }
  }

  async disposeAll(): Promise<void> {
    for (const [id] of this.activeClients) {
      await this.disconnect(id);
    }
    this._onDidChangeConnections.fire();
  }
}
