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
import { UsersStaffPage } from './pages/UsersStaffPage.jsx';
import { AddUserPage } from './pages/AddUserPage.jsx';
import { UserDetailPage } from './pages/UserDetailPage.jsx';
import { ChangePasswordPage } from './pages/ChangePasswordPage.jsx';
import { ShopsManagePage } from './pages/ShopsManagePage.jsx';
import { AddShopPage } from './pages/AddShopPage.jsx';
import { ManageShopPage } from './pages/ManageShopPage.jsx';
import { AppShell } from './components/AppShell.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';
import { OwnerRoute } from './routes/OwnerRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />

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
          {/* OWNER-only pages — OwnerRoute redirects non-owners to "/" as a
              UX guard; the backend still enforces requireRole(OWNER) on
              every one of these requests regardless. */}
          <Route element={<OwnerRoute />}>
            <Route path="/users" element={<UsersStaffPage />} />
            <Route path="/users/new" element={<AddUserPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/shops/manage" element={<ShopsManagePage />} />
            <Route path="/shops/manage/new" element={<AddShopPage />} />
            <Route path="/shops/manage/:shopId" element={<ManageShopPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
