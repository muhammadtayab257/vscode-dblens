import { ConnectionManager } from '../connections/ConnectionManager';
import { TableInfo, ForeignKey, ColumnInfo } from '../connections/types';

export interface SchemaData {
  tables: TableInfo[];
  foreignKeys: ForeignKey[];
}

export class SchemaProvider {
  constructor(private readonly connectionManager: ConnectionManager) {}

  async getSchema(connectionId: string): Promise<SchemaData> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) {
      throw new Error('Not connected to database');
    }

    const tableNames = await client.getTables();
    const tables: TableInfo[] = [];

    for (const name of tableNames) {
      const columns: ColumnInfo[] = await client.getColumns(name);
      tables.push({
        name,
        schema: 'public',
        columns,
      });
    }

    const foreignKeys = await client.getForeignKeys();

    return { tables, foreignKeys };
  }
}
