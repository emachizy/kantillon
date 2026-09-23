import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { ShopInventoryPage } from './pages/ShopInventoryPage.jsx';
import { PendingApprovalsPage } from './pages/PendingApprovalsPage.jsx';
import { ReceiptHistoryPage } from './pages/ReceiptHistoryPage.jsx';
import { DailyReportFormPage } from './pages/DailyReportFormPage.jsx';
import { DailyReportDetailPage } from './pages/DailyReportDetailPage.jsx';
import { CorrectionRequestFormPage } from './pages/CorrectionRequestFormPage.jsx';
import { OwnerDailySummaryPage } from './pages/OwnerDailySummaryPage.jsx';
import { AppShell } from './components/AppShell.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/shops/:shopId" element={<ShopInventoryPage />} />
          <Route
            path="/shops/:shopId/products/:productId/daily-report"
            element={<DailyReportFormPage />}
          />
          <Route path="/daily-reports/:id" element={<DailyReportDetailPage />} />
          <Route path="/daily-reports/:id/request-correction" element={<CorrectionRequestFormPage />} />
          <Route path="/daily-summary" element={<OwnerDailySummaryPage />} />
          <Route path="/approvals" element={<PendingApprovalsPage />} />
          <Route path="/receipts" element={<ReceiptHistoryPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
