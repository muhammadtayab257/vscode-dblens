import { Client } from 'pg';
import { DBConnection, DatabaseClient, ColumnInfo, ForeignKey, QueryResult } from './types';

export class PostgresClient implements DatabaseClient {
  private client: Client | null = null;
  private connected = false;

  constructor(
    private readonly config: DBConnection,
    private readonly password?: string
  ) {}

  async connect(): Promise<void> {
    this.client = new Client({
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      database: this.config.database,
      user: this.config.username,
      password: this.password,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });

    // Handle unexpected connection loss
    this.client.on('error', () => {
      this.connected = false;
      this.client = null;
    });

    await this.client.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  private ensureConnected(): Client {
    if (!this.client || !this.connected) {
      throw new Error('Not connected to database');
    }
    return this.client;
  }

  async getTables(): Promise<string[]> {
    const client = this.ensureConnected();
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return result.rows.map((r: Record<string, unknown>) => r.table_name as string);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const client = this.ensureConnected();
    const pks = await this.getPrimaryKeys(tableName);
    const result = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: (r.is_nullable as string) === 'YES',
      defaultValue: r.column_default as string | null,
      isPrimaryKey: pks.includes(r.column_name as string),
    }));
  }

  async getAllColumns(): Promise<Record<string, ColumnInfo[]>> {
    const client = this.ensureConnected();
    const result = await client.query(
      `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default,
              CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
       FROM information_schema.columns c
       LEFT JOIN (
         SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
       ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
       WHERE c.table_schema = 'public'
       ORDER BY c.table_name, c.ordinal_position`
    );
    const map: Record<string, ColumnInfo[]> = {};
    for (const r of result.rows as Record<string, unknown>[]) {
      const table = r.table_name as string;
      if (!map[table]) { map[table] = []; }
      map[table].push({
        name: r.column_name as string,
        type: r.data_type as string,
        nullable: (r.is_nullable as string) === 'YES',
        defaultValue: r.column_default as string | null,
        isPrimaryKey: !!(r.is_primary_key),
      });
    }
    return map;
  }

  async getForeignKeys(): Promise<ForeignKey[]> {
    const client = this.ensureConnected();
    const result = await client.query(
      `SELECT
        kcu.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'`
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      fromTable: r.from_table as string,
      fromColumn: r.from_column as string,
      toTable: r.to_table as string,
      toColumn: r.to_column as string,
    }));
  }

  async getPrimaryKeys(tableName: string): Promise<string[]> {
    const client = this.ensureConnected();
    const result = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = $1`,
      [tableName]
    );
    return result.rows.map((r: Record<string, unknown>) => r.column_name as string);
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const client = this.ensureConnected();
    const start = Date.now();
    try {
      const result = await client.query(sql);
      const elapsed = Date.now() - start;
      const rows = result.rows || [];
      const columns = result.fields ? result.fields.map(f => f.name) : [];
      return {
        columns,
        rows,
        rowCount: result.rowCount ?? rows.length,
        executionTimeMs: elapsed,
      };
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: elapsed,
        error: message,
      };
    }
  }

  async getTableData(
    tableName: string,
    limit: number,
    offset: number,
    sortColumn?: string,
    sortDirection: 'ASC' | 'DESC' = 'ASC',
    filter?: string
  ): Promise<QueryResult> {
    const identifier = `"${tableName.replace(/"/g, '""')}"`;
    let sql = `SELECT * FROM ${identifier}`;
    if (filter) {
      sql += ` WHERE ${filter}`;
    }
    if (sortColumn) {
      const sortId = `"${sortColumn.replace(/"/g, '""')}"`;
      sql += ` ORDER BY ${sortId} ${sortDirection}`;
    }
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    return this.executeQuery(sql);
  }

  async getTableRowCount(tableName: string): Promise<number> {
    const identifier = `"${tableName.replace(/"/g, '""')}"`;
    const result = await this.executeQuery(`SELECT COUNT(*) AS count FROM ${identifier}`);
    if (result.error) {
      throw new Error(result.error);
    }
    return parseInt(String(result.rows[0]?.count ?? '0'), 10);
  }
}
