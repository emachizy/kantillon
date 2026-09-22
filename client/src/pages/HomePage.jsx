import { useAuth } from '../context/AuthContext.jsx';
import { OwnerHomePage } from './OwnerHomePage.jsx';
import { StaffHomePage } from './StaffHomePage.jsx';

export function HomePage() {
  const { user } = useAuth();
  return user?.role === 'OWNER' ? <OwnerHomePage /> : <StaffHomePage />;
}
