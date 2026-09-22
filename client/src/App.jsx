import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { ShopInventoryPage } from './pages/ShopInventoryPage.jsx';
import { PendingApprovalsPage } from './pages/PendingApprovalsPage.jsx';
import { ReceiptHistoryPage } from './pages/ReceiptHistoryPage.jsx';
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
          <Route path="/approvals" element={<PendingApprovalsPage />} />
          <Route path="/receipts" element={<ReceiptHistoryPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
