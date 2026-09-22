import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDailyReport } from '../api/dailyReports.js';
import { formatKoboAsNaira } from '../utils/money.js';

export function DailyReportDetailPage() {
  const { id } = useParams();

  const reportQuery = useQuery({
    queryKey: ['dailyReports', 'detail', id],
    queryFn: () => fetchDailyReport(id),
  });

  if (reportQuery.isLoading) return <p className="text-sm text-slate-500">Loading report...</p>;
  if (reportQuery.isError) {
    const status = reportQuery.error?.response?.status;
    return (
      <p className="text-sm text-red-600">
        {status === 403 ? 'You do not have access to this report.' : 'Failed to load report.'}
      </p>
    );
  }

  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">
        {report.shopId?.name} — {report.businessDate}
      </h1>
      <p className="text-sm text-slate-500">{report.productId?.name}</p>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Sales lines</h2>
        {report.salesLines.map((line, i) => (
          <p key={i} className="text-sm text-slate-700">
            {line.quantity} bags @ {formatKoboAsNaira(line.unitPriceKobo)} ={' '}
            {formatKoboAsNaira(line.lineRevenueKobo)}
          </p>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Stock reconciliation</h2>
        <Row label="Opening stock" value={report.openingStockQuantity} />
        <Row label="Approved received" value={report.approvedStockReceivedQuantity} />
        <Row label="Available stock" value={report.availableStockQuantity} />
        <Row label="Bags sold" value={report.totalQuantitySold} />
        <Row label="Expected closing" value={report.expectedClosingStockQuantity} />
        <Row label="Physical closing" value={report.physicalClosingStockQuantity} />
        <Row
          label="Stock variance"
          value={`${report.stockVarianceQuantity} (${
            report.stockVarianceQuantity === 0
              ? 'BALANCED'
              : report.stockVarianceQuantity < 0
                ? 'SHORTAGE'
                : 'SURPLUS'
          })`}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Money reconciliation</h2>
        <Row label="Expected revenue" value={formatKoboAsNaira(report.expectedRevenueKobo)} />
        <Row label="Amount collected" value={formatKoboAsNaira(report.actualAmountCollectedKobo)} />
        <Row
          label="Money variance"
          value={`${formatKoboAsNaira(report.moneyVarianceKobo)} (${
            report.moneyVarianceKobo === 0
              ? 'BALANCED'
              : report.moneyVarianceKobo < 0
                ? 'MONEY SHORT'
                : 'MONEY SURPLUS'
          })`}
        />
      </div>

      {report.notes && <p className="text-sm text-slate-500">Notes: {report.notes}</p>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
