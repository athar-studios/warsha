// packages/ui/src/v3/composites/DataTable.tsx — Design System v3 DataTable (DS v3 §3.2)
// Sortable headers with aria-sort, row Menu, compact density, scope="col".

import React from 'react';

import { IconArrow, IconMore } from '../icons';
import { IconButton } from '../primitives/IconButton';

import { Menu, type MenuItem } from './Menu';

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  accessor?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'start' | 'center' | 'end';
  width?: string;
}

export interface DataTableRowAction<T> {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  destructive?: boolean;
  disabled?: boolean;
  'data-action'?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  rowActions?: DataTableRowAction<T>[] | ((row: T) => DataTableRowAction<T>[]);
  actionsLabel?: string;
  compact?: boolean;
  emptyState?: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  sortColumn,
  sortDirection = 'asc',
  onSort,
  rowActions,
  actionsLabel = '',
  compact = false,
  emptyState,
  ariaLabel,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}: DataTableProps<T>): React.ReactElement {
  const handleHeaderClick = (col: DataTableColumn<T>) => {
    if (!col.sortable || !onSort) return;
    const nextDir =
      sortColumn === col.id && sortDirection === 'asc' ? 'desc' : 'asc';
    onSort(col.id, nextDir);
  };

  const hasRowActions = Boolean(rowActions);

  return (
    <div
      data-density={compact ? 'compact' : undefined}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-data-table-container ${className}`.trim()}
      style={{
        width: '100%',
        overflowX: 'auto',
        border: 'var(--w-border-width) solid var(--w-line)',
        borderRadius: 'var(--w-radius-md)',
        backgroundColor: 'var(--w-surface)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <table
        aria-label={ariaLabel}
        className="w-data-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--w-font-sans)',
          fontSize: compact ? 'var(--w-font-size-sm)' : 'var(--w-table-text-size)',
          lineHeight: compact ? 'var(--w-line-height-sm)' : 'var(--w-table-line-height)',
          textAlign: 'start',
        }}
      >
        <thead>
          <tr
            style={{
              backgroundColor: 'var(--w-sunken)',
              borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            }}
          >
            {columns.map((col) => {
              const isSorted = sortColumn === col.id;
              const ariaSort = !col.sortable
                ? undefined
                : isSorted
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';

              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={ariaSort}
                  onClick={() => handleHeaderClick(col)}
                  style={{
                    paddingBlock: compact ? 'var(--w-space-2)' : 'var(--w-space-3)',
                    paddingInline: compact ? 'var(--w-space-3)' : 'var(--w-space-4)',
                    fontWeight: 'var(--w-font-weight-semibold)',
                    color: 'var(--w-text-muted)',
                    textAlign: col.align ?? 'start',
                    width: col.width,
                    cursor: col.sortable ? 'pointer' : 'default',
                    userSelect: col.sortable ? 'none' : undefined,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--w-space-1)',
                    }}
                  >
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          color: isSorted ? 'var(--w-primary-text)' : 'var(--w-text-faint)',
                          transform: isSorted && sortDirection === 'desc' ? 'rotate(180deg)' : 'none',
                          transition: 'transform var(--w-dur-fast) var(--w-ease)',
                        }}
                      >
                        <IconArrow size={14} />
                      </span>
                    )}
                  </div>
                </th>
              );
            })}

            {hasRowActions && (
              <th
                scope="col"
                style={{
                  width: 'var(--w-space-10)',
                  paddingBlock: compact ? 'var(--w-space-2)' : 'var(--w-space-3)',
                  paddingInline: compact ? 'var(--w-space-3)' : 'var(--w-space-4)',
                }}
              >
                <span className="w-sr-only" style={{ visibility: 'hidden' }}>
                  {actionsLabel}
                </span>
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (hasRowActions ? 1 : 0)}
                style={{
                  paddingBlock: 'var(--w-space-6)',
                  paddingInline: 'var(--w-space-4)',
                  textAlign: 'center',
                  color: 'var(--w-text-muted)',
                }}
              >
                {emptyState}
              </td>
            </tr>
          ) : (
            data.map((row, index) => {
              const rowKey = keyExtractor(row, index);
              const actions =
                typeof rowActions === 'function' ? rowActions(row) : rowActions;

              const menuItems: MenuItem[] = (actions ?? []).map((act) => ({
                id: act.id,
                label: act.label,
                icon: act.icon,
                destructive: act.destructive,
                disabled: act.disabled,
                'data-action': act['data-action'],
                onClick: () => act.onClick(row),
              }));

              return (
                <tr
                  key={rowKey}
                  style={{
                    borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
                    backgroundColor: 'var(--w-surface)',
                    transition: 'background-color var(--w-dur-fast) var(--w-ease)',
                  }}
                >
                  {columns.map((col) => {
                    const content = col.accessor
                      ? col.accessor(row)
                      : (row as Record<string, unknown>)[col.id] != null
                        ? String((row as Record<string, unknown>)[col.id])
                        : null;

                    return (
                      <td
                        key={col.id}
                        style={{
                          paddingBlock: compact ? 'var(--w-space-2)' : 'var(--w-space-3)',
                          paddingInline: compact ? 'var(--w-space-3)' : 'var(--w-space-4)',
                          textAlign: col.align ?? 'start',
                          color: 'var(--w-text)',
                        }}
                      >
                        {content}
                      </td>
                    );
                  })}

                  {hasRowActions && (
                    <td
                      style={{
                        paddingBlock: compact ? 'var(--w-space-2)' : 'var(--w-space-3)',
                        paddingInline: compact ? 'var(--w-space-3)' : 'var(--w-space-4)',
                        textAlign: 'end',
                      }}
                    >
                      {menuItems.length > 0 && (
                        <Menu
                          trigger={
                            <IconButton
                              icon={<IconMore size={16} />}
                              label={actionsLabel}
                              variant="ghost"
                              size="sm"
                              data-action="table.row-menu"
                            />
                          }
                          items={menuItems}
                          ariaLabel={actionsLabel}
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

DataTable.displayName = 'DataTable';
