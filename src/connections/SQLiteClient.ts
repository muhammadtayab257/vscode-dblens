import * as fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { DBConnection, DatabaseClient, ColumnInfo, ForeignKey, QueryResult } from './types';

export class SQLiteClient implements DatabaseClient {
  private db: SqlJsDatabase | null = null;
  private connected = false;
  private filePath: string;

  constructor(private readonly config: DBConnection) {
    this.filePath = config.filePath || config.database;
  }

  async connect(): Promise<void> {
    if (!this.filePath) {
      throw new Error('SQLite requires a file path');
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(this.filePath)) {
      const buffer = fs.readFileSync(this.filePath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run('PRAGMA journal_mode = WAL');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      // Save changes back to file before closing
      this.saveToFile();
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.db !== null;
  }

  private ensureConnected(): SqlJsDatabase {
    if (!this.db || !this.connected) {
      throw new Error('Not connected to database');
    }
    return this.db;
  }

  private saveToFile(): void {
    if (this.db && this.filePath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.filePath, buffer);
    }
  }

  private queryAll(sql: string): Record<string, unknown>[] {
    const db = this.ensureConnected();
    const stmt = db.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row as Record<string, unknown>);
    }
    stmt.free();
    return rows;
  }

  async getTables(): Promise<string[]> {
    const rows = this.queryAll(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    );
    return rows.map(r => r.name as string);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const escapedName = tableName.replace(/"/g, '""');
    const rows = this.queryAll(`PRAGMA table_info("${escapedName}")`);
    return rows.map(c => ({
      name: c.name as string,
      type: (c.type as string) || 'TEXT',
      nullable: (c.notnull as number) === 0,
      defaultValue: c.dflt_value as string | null,
      isPrimaryKey: (c.pk as number) > 0,
    }));
  }

  async getAllColumns(): Promise<Record<string, ColumnInfo[]>> {
    const tables = await this.getTables();
    const map: Record<string, ColumnInfo[]> = {};
    for (const table of tables) {
      map[table] = await this.getColumns(table);
    }
    return map;
  }

  async getForeignKeys(): Promise<ForeignKey[]> {
    const tables = await this.getTables();
    const foreignKeys: ForeignKey[] = [];

    for (const table of tables) {
      const escapedName = table.replace(/"/g, '""');
      const fks = this.queryAll(`PRAGMA foreign_key_list("${escapedName}")`);
      for (const fk of fks) {
        foreignKeys.push({
          fromTable: table,
          fromColumn: fk.from as string,
          toTable: fk.table as string,
          toColumn: fk.to as string,
        });
      }
    }
    return foreignKeys;
  }

  async getPrimaryKeys(tableName: string): Promise<string[]> {
    const columns = await this.getColumns(tableName);
    return columns.filter(c => c.isPrimaryKey).map(c => c.name);
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const db = this.ensureConnected();
    const start = Date.now();
    try {
      const trimmed = sql.trim().toUpperCase();
      const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH');

      if (isSelect) {
        const rows = this.queryAll(sql);
        const elapsed = Date.now() - start;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          columns,
          rows,
          rowCount: rows.length,
          executionTimeMs: elapsed,
        };
      } else {
        db.run(sql);
        const elapsed = Date.now() - start;
        const changes = db.getRowsModified();
        this.saveToFile();
        return {
          columns: ['changes'],
          rows: [{ changes }],
          rowCount: changes,
          executionTimeMs: elapsed,
        };
      }
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
