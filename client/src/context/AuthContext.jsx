import { createContext, useContext, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, loginRequest, logoutRequest } from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  // Restores the session on page load by asking the backend who the
  // httpOnly cookie belongs to. A 401 here just means "not logged in".
  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (loggedInUser) => {
      queryClient.setQueryData(['auth', 'me'], loggedInUser);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      queryClient.setQueryData(['auth', 'me'], null);
      queryClient.clear();
    },
  });

  const value = useMemo(
    () => ({
      user: user || null,
      isAuthenticated: Boolean(user),
      isLoading,
      login: loginMutation.mutateAsync,
      loginError: loginMutation.error,
      isLoggingIn: loginMutation.isPending,
      logout: logoutMutation.mutateAsync,
    }),
    [user, isLoading, loginMutation, logoutMutation]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
