import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import ShopsList from './pages/ShopsList';
import ShopLogs from './pages/ShopLogs';
import ShopDetail from './pages/ShopDetail';
import Plans from './pages/Plans';
import TicketsList from './pages/TicketsList';
import Settings from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="merchants" element={<ShopsList />} />
          <Route path="merchants/:id" element={<ShopDetail />} />
          <Route path="shops" element={<ShopsList />} />
          <Route path="shops/:id" element={<ShopDetail />} />
          <Route path="shops/:id/logs" element={<ShopLogs />} />
          <Route path="plans" element={<Plans />} />
          <Route path="support" element={<TicketsList />} />
          <Route path="config" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
