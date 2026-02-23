import { TableInfo, ForeignKey, ColumnInfo } from '../connections/types';

interface ParsedSchema {
  tables: TableInfo[];
  foreignKeys: ForeignKey[];
}

export function parseSQLSchema(sql: string): ParsedSchema {
  const tables: TableInfo[] = [];
  const foreignKeys: ForeignKey[] = [];

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: ColumnInfo[] = [];
    const primaryKeys: string[] = [];

    const lines = body.split(',').map(l => l.trim()).filter(l => l.length > 0);

    for (const line of lines) {
      const pkMatch = line.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        const pkCols = pkMatch[1].split(',').map(c => c.trim().replace(/["`]/g, ''));
        primaryKeys.push(...pkCols);
        continue;
      }

      const fkMatch = line.match(
        /FOREIGN\s+KEY\s*\(["`]?(\w+)["`]?\)\s*REFERENCES\s+["`]?(\w+)["`]?\s*\(["`]?(\w+)["`]?\)/i
      );
      if (fkMatch) {
        foreignKeys.push({
          fromTable: tableName,
          fromColumn: fkMatch[1],
          toTable: fkMatch[2],
          toColumn: fkMatch[3],
        });
        continue;
      }

      const colMatch = line.match(/^["`]?(\w+)["`]?\s+(\w+(?:\([^)]*\))?)/);
      if (colMatch) {
        const isPk = /PRIMARY\s+KEY/i.test(line);
        const isNullable = !/NOT\s+NULL/i.test(line);
        const defaultMatch = line.match(/DEFAULT\s+(.+?)(?:\s|,|$)/i);

        if (isPk) {
          primaryKeys.push(colMatch[1]);
        }

        // Check for inline REFERENCES
        const refMatch = line.match(
          /REFERENCES\s+["`]?(\w+)["`]?\s*\(["`]?(\w+)["`]?\)/i
        );
        if (refMatch) {
          foreignKeys.push({
            fromTable: tableName,
            fromColumn: colMatch[1],
            toTable: refMatch[1],
            toColumn: refMatch[2],
          });
        }

        columns.push({
          name: colMatch[1],
          type: colMatch[2].toUpperCase(),
          nullable: isNullable && !isPk,
          defaultValue: defaultMatch ? defaultMatch[1] : null,
          isPrimaryKey: isPk,
        });
      }
    }

    // Mark composite primary keys
    for (const pkCol of primaryKeys) {
      const col = columns.find(c => c.name === pkCol);
      if (col) {
        col.isPrimaryKey = true;
      }
    }

    tables.push({ name: tableName, schema: 'public', columns });
  }

  return { tables, foreignKeys };
}
