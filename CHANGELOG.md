# Changelog

All notable changes to the **DBLens** extension will be documented in this file.

## [0.1.0] - 2024-12-01

### Added
- **Connection Manager** with support for PostgreSQL, MySQL, and SQLite
  - Secure password storage using VS Code SecretStorage
  - Connection string parsing (paste `postgresql://...` or `mysql://...`)
  - Test connection before saving
  - Auto-connect on save
- **Sidebar TreeView** showing connections, tables, and columns
  - Expandable hierarchy: Connection > Tables > Columns
  - Primary key indicators on columns
  - Click table to view data
  - Right-click context menus for all actions
- **SQL Editor** with integrated results
  - Monospace editor with line numbers
  - Connection selector dropdown
  - Run with Ctrl+Enter or Run button
  - Results table with click-to-copy cells
  - Query history with one-click recall
  - Export results as CSV
  - SQL autocomplete for table and column names
- **Table Data Viewer**
  - Paginated data grid (50 rows/page)
  - Click column headers to sort
  - Filter/search rows
  - Export to CSV
  - Click any cell to copy its value
  - Keyboard navigation (arrow keys for pages)
- **Schema Visualizer** (ER Diagram)
  - Interactive entity-relationship diagram
  - Draggable table cards
  - SVG bezier arrows for foreign key relationships
  - Pan and zoom with mouse/trackpad
  - Minimap for navigation
  - Auto-layout using BFS graph algorithm
- **Theme Support** -- works with any VS Code theme (dark, light, high contrast)
