import { Navigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

// Wraps protected routes. Redirects to /signin when unauthenticated.
export default function RequireAuth({ children }) {
  const { session, loadingAuth } = useAppContext();
  const location = useLocation();

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-full border-4 border-teal-500 border-t-transparent animate-spin" />
          <p className="text-sm text-slate-500">Loading Apex Scholars…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return children;
}
