import { TableInfo, ForeignKey } from '../connections/types';

export interface TablePosition {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TABLE_WIDTH = 240;
const ROW_HEIGHT = 28;
const TABLE_HEADER_HEIGHT = 40;
const TABLE_PADDING = 16;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 60;

export function calculateTableHeight(table: TableInfo): number {
  return TABLE_HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + TABLE_PADDING;
}

export function autoLayoutTables(
  tables: TableInfo[],
  foreignKeys: ForeignKey[]
): TablePosition[] {
  if (tables.length === 0) {
    return [];
  }

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  for (const t of tables) {
    adjacency.set(t.name, new Set());
  }
  for (const fk of foreignKeys) {
    adjacency.get(fk.fromTable)?.add(fk.toTable);
    adjacency.get(fk.toTable)?.add(fk.fromTable);
  }

  // BFS to find connected components and assign layers
  const visited = new Set<string>();
  const layers: string[][] = [];

  // Start with tables that have the most connections
  const sortedTables = [...tables].sort((a, b) => {
    const aConns = adjacency.get(a.name)?.size ?? 0;
    const bConns = adjacency.get(b.name)?.size ?? 0;
    return bConns - aConns;
  });

  for (const table of sortedTables) {
    if (visited.has(table.name)) {
      continue;
    }

    // BFS from this root
    const queue: { name: string; depth: number }[] = [{ name: table.name, depth: 0 }];
    visited.add(table.name);

    while (queue.length > 0) {
      const { name, depth } = queue.shift()!;

      while (layers.length <= depth) {
        layers.push([]);
      }
      layers[depth].push(name);

      const neighbors = adjacency.get(name) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ name: neighbor, depth: depth + 1 });
        }
      }
    }
  }

  // Add any remaining unvisited tables
  for (const table of tables) {
    if (!visited.has(table.name)) {
      if (layers.length === 0) {
        layers.push([]);
      }
      layers[layers.length - 1].push(table.name);
    }
  }

  // Assign positions
  const tableMap = new Map<string, TableInfo>();
  for (const t of tables) {
    tableMap.set(t.name, t);
  }

  const positions: TablePosition[] = [];
  let currentX = 50;

  for (const layer of layers) {
    let currentY = 50;
    let maxWidth = 0;

    for (const tableName of layer) {
      const table = tableMap.get(tableName);
      if (!table) {
        continue;
      }

      const height = calculateTableHeight(table);
      positions.push({
        name: tableName,
        x: currentX,
        y: currentY,
        width: TABLE_WIDTH,
        height,
      });

      currentY += height + VERTICAL_GAP;
      maxWidth = Math.max(maxWidth, TABLE_WIDTH);
    }

    currentX += maxWidth + HORIZONTAL_GAP;
  }

  return positions;
}
