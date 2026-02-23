export interface DBConnection {
  id: string;
  name: string;
  type: 'postgresql' | 'mysql' | 'sqlite';
  host?: string;
  port?: number;
  database: string;
  username?: string;
  filePath?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
}

export interface ForeignKey {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export interface DatabaseClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getTables(): Promise<string[]>;
  getColumns(tableName: string): Promise<ColumnInfo[]>;
  getForeignKeys(): Promise<ForeignKey[]>;
  getPrimaryKeys(tableName: string): Promise<string[]>;
  executeQuery(sql: string): Promise<QueryResult>;
  getTableData(tableName: string, limit: number, offset: number, sortColumn?: string, sortDirection?: 'ASC' | 'DESC', filter?: string): Promise<QueryResult>;
  getTableRowCount(tableName: string): Promise<number>;
}
