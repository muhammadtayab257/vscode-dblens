# DBLens — Database Explorer for VS Code

Browse tables and run queries directly inside Visual Studio Code. Supports **PostgreSQL**, **MySQL**, and **SQLite**.

## Features

### Sidebar Connection Explorer
- Add, edit, and remove database connections from the activity bar
- Browse tables and columns in a tree view
- Green indicator for active connections
- Right-click context menus for quick actions

### Connection Form
- Visual form to configure connections (no more typing in input boxes)
- Quick Connect via connection string — paste a `postgresql://` or `mysql://` URI and fields auto-fill
- Test Connection button to verify before saving
- Browse button for SQLite file selection
- Auto-connects after saving

### Table Data Viewer
- Paginated table grid with sorting by any column
- Filter rows with a WHERE clause
- Click any cell to copy its value
- Export table data to CSV
- Works with VS Code light and dark themes

### SQL Editor
- Full SQL editor with line numbers and syntax-aware editing
- Connection dropdown to switch databases
- Run queries with the toolbar button or keyboard shortcut
- Resizable split pane — editor on top, results below
- SQL autocomplete for table names, column names, and keywords
- Query history tab to re-run previous queries
- Export query results to CSV

### Quick Query Runner
- Run SQL from any `.sql` file — select text or run the whole file
- `Ctrl+Enter` keyboard shortcut in SQL files
- Results appear in a dedicated panel

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Click the **DBLens** icon in the activity bar (database icon)
3. Click the **+** button to add a connection
4. Fill in your database details or paste a connection string
5. Click **Save & Connect**

## Supported Databases

| Database   | Versions | Connection |
|------------|----------|------------|
| PostgreSQL | 10+      | Host/port or connection string |
| MySQL      | 5.7+     | Host/port or connection string |
| SQLite     | 3.x      | File path |

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `DBLens: Add Connection` | Open connection form |
| `DBLens: Open Query Editor` | Open the SQL editor |
| `DBLens: Run Query` | Execute SQL from current editor |
| `DBLens: Export as CSV` | Export a table to CSV |
| `DBLens: Refresh` | Refresh the connection tree |

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Ctrl+Enter` | SQL file | Run query |

## Requirements

- VS Code 1.85.0 or later
- Network access to your database server (PostgreSQL/MySQL)
- SQLite database file on disk

## Extension Settings

This extension does not add any VS Code settings. All configuration is managed through the connection form.

## Privacy & Security

- Passwords are stored in VS Code's built-in **SecretStorage** (OS keychain)
- Connection details are stored in VS Code workspace state
- No data is sent to external servers — all queries run directly against your database

## Known Issues

- SQLite uses an in-memory engine (sql.js) — very large databases may be slow to load

## License

[MIT](LICENSE)
