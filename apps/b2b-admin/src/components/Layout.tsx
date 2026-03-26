import React, { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { api } from '../api';

export const Layout = () => {
  const [isValidating, setIsValidating] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    api.get('/auth').then(() => {
      setIsAuthenticated(true);
    }).catch(() => {
      setIsAuthenticated(false);
    }).finally(() => {
      setIsValidating(false);
    });
  }, []);

  if (isValidating) return <div style={{ padding: '2rem', color: 'white' }}>Loading application...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', marginLeft: 'calc(260px + 2rem)' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
