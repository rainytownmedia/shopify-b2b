import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Store, CreditCard, Settings, MessageSquare, LogOut } from 'lucide-react';

const Sidebar = () => {
  return (
    <aside className="glass" style={{
      width: '260px',
      height: 'calc(100vh - 2rem)',
      position: 'fixed',
      top: '1rem',
      left: '1rem',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem'
    }}>
      <div style={{ padding: '0 1rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          SuperAdmin
        </h2>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
          <LayoutDashboard size={20} />
          Dashboard
        </NavLink>
        <NavLink to="/shops" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Store size={20} />
          Merchants
        </NavLink>
        <NavLink to="/plans" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <CreditCard size={20} />
          Billing Plans
        </NavLink>

        <NavLink to="/support" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <MessageSquare size={20} />
          Support Tickets
        </NavLink>

        <NavLink to="/config" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Settings size={20} />
          Settings
        </NavLink>
      </nav>

      <button className="btn btn-glass" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => {
        // Mock logout
        window.location.href = '/login';
      }}>
        <LogOut size={20} />
        Logout
      </button>

      <style>{`
        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          text-decoration: none;
          transition: all 0.2s ease;
          font-weight: 500;
        }
        .nav-item:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }
        .nav-item.active {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.15));
          color: var(--accent-secondary);
          border-left: 3px solid var(--accent-primary);
        }
      `}</style>
    </aside>
  );
};

export default Sidebar;
