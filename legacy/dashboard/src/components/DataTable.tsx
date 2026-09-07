import type { ReactNode } from 'react';

type Column<T> = {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  data: T[];
  columns: Column<T>[];
  emptyState?: ReactNode;
};

export function DataTable<T>({ data, columns, emptyState }: DataTableProps<T>) {
  if (!data.length) {
    return (
      <div className="glass-panel p-8 border border-white/5 text-center text-white/60">
        {emptyState ?? 'No records yet.'}
      </div>
    );
  }

  return (
    <div className="glass-panel border border-white/10 overflow-hidden">
      <table className="min-w-full divide-y divide-white/10">
        <thead className="bg-white/5">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className={`px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/60 ${column.className ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {data.map((row, index) => (
            <tr key={index} className="hover:bg-white/5 transition-colors">
              {columns.map((column) => (
                <td key={column.header} className={`px-6 py-4 text-sm text-white/80 ${column.className ?? ''}`}>
                  {column.accessor(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
