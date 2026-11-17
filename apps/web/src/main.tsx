import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import './index.css';
import { ArenaPage } from './pages/Arena';
import { HowItWorksPage } from './pages/HowItWorks';
import { LandingPage } from './pages/Landing';
import { LeaderboardPage } from './pages/Leaderboard';
import { MatchPage } from './pages/Match';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { registerDemoWallet } from './wallet/demoWallet';
import { WalletProvider } from './wallet/WalletContext';

registerDemoWallet();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/arena', element: <ArenaPage /> },
      { path: '/match/:id', element: <MatchPage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/players/:id', element: <ProfilePage /> },
      { path: '/how-it-works', element: <HowItWorksPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <RouterProvider router={router} />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ className: '!bg-bg-raised !border-line-strong !text-fg', style: { fontFamily: 'Geist, sans-serif' } }}
        />
      </WalletProvider>
    </QueryClientProvider>
  </StrictMode>,
);
