import * as mysql from 'mysql2/promise';
import { DBConnection, DatabaseClient, ColumnInfo, ForeignKey, QueryResult } from './types';

export class MySQLClient implements DatabaseClient {
  private connection: mysql.Connection | null = null;
  private connected = false;

  constructor(
    private readonly config: DBConnection,
    private readonly password?: string
  ) {}

  async connect(): Promise<void> {
    this.connection = await mysql.createConnection({
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      database: this.config.database,
      user: this.config.username,
      password: this.password,
      connectTimeout: 10000,
    });

    // Handle unexpected connection loss
    this.connection.on('error', () => {
      this.connected = false;
      this.connection = null;
    });

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.connection !== null;
  }

  private ensureConnected(): mysql.Connection {
    if (!this.connection || !this.connected) {
      throw new Error('Not connected to database');
    }
    return this.connection;
  }

  async getTables(): Promise<string[]> {
    const conn = this.ensureConnected();
    const [rows] = await conn.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [this.config.database]
    );
    return (rows as Record<string, unknown>[]).map(r => (r.TABLE_NAME || r.table_name) as string);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const conn = this.ensureConnected();
    const pks = await this.getPrimaryKeys(tableName);
    const [rows] = await conn.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [this.config.database, tableName]
    );
    return (rows as Record<string, unknown>[]).map(r => ({
      name: (r.COLUMN_NAME || r.column_name) as string,
      type: (r.DATA_TYPE || r.data_type) as string,
      nullable: ((r.IS_NULLABLE || r.is_nullable) as string) === 'YES',
      defaultValue: (r.COLUMN_DEFAULT || r.column_default) as string | null,
      isPrimaryKey: pks.includes((r.COLUMN_NAME || r.column_name) as string),
    }));
  }

  async getForeignKeys(): Promise<ForeignKey[]> {
    const conn = this.ensureConnected();
    const [rows] = await conn.query(
      `SELECT
        kcu.TABLE_NAME AS from_table,
        kcu.COLUMN_NAME AS from_column,
        kcu.REFERENCED_TABLE_NAME AS to_table,
        kcu.REFERENCED_COLUMN_NAME AS to_column
       FROM information_schema.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.config.database]
    );
    return (rows as Record<string, unknown>[]).map(r => ({
      fromTable: (r.from_table || r.FROM_TABLE) as string,
      fromColumn: (r.from_column || r.FROM_COLUMN) as string,
      toTable: (r.to_table || r.TO_TABLE) as string,
      toColumn: (r.to_column || r.TO_COLUMN) as string,
    }));
  }

  async getPrimaryKeys(tableName: string): Promise<string[]> {
    const conn = this.ensureConnected();
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = 'PRIMARY'`,
      [this.config.database, tableName]
    );
    return (rows as Record<string, unknown>[]).map(r => (r.COLUMN_NAME || r.column_name) as string);
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const conn = this.ensureConnected();
    const start = Date.now();
    try {
      const [rows, fields] = await conn.query(sql);
      const elapsed = Date.now() - start;
      const resultRows = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
      const columns = fields && Array.isArray(fields)
        ? fields.map(f => f.name)
        : Object.keys(resultRows[0] || {});
      return {
        columns,
        rows: resultRows,
        rowCount: resultRows.length,
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
    const identifier = `\`${tableName.replace(/`/g, '``')}\``;
    let sql = `SELECT * FROM ${identifier}`;
    if (filter) {
      sql += ` WHERE ${filter}`;
    }
    if (sortColumn) {
      const sortId = `\`${sortColumn.replace(/`/g, '``')}\``;
      sql += ` ORDER BY ${sortId} ${sortDirection}`;
    }
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    return this.executeQuery(sql);
  }

  async getTableRowCount(tableName: string): Promise<number> {
    const identifier = `\`${tableName.replace(/`/g, '``')}\``;
    const result = await this.executeQuery(`SELECT COUNT(*) AS count FROM ${identifier}`);
    if (result.error) {
      throw new Error(result.error);
    }
    return parseInt(String(result.rows[0]?.count ?? '0'), 10);
  }
}
