import React, { useEffect, useState } from 'react';
import { api } from '../api';

const Dashboard = () => {
  const [stats, setStats] = useState<any>(null);
  const [billingStats, setBillingStats] = useState<any>(null);

  useEffect(() => {
    api.get('/analytics/dashboard').then(res => setStats(res.data)).catch(console.error);
    api.get('/billing/stats').then(res => setBillingStats(res.data.stats)).catch(console.error);
  }, []);

  if (!stats || !billingStats) return <div className="text-secondary" style={{ padding: '2rem' }}>Loading dashboard...</div>;

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Dashboard Overview</h1>
      
      {/* Top Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="glass-card">
          <h3 className="text-secondary text-sm">Monthly Revenue (Est.)</h3>
          <p style={{ fontSize: '2rem', fontWeight: 600, margin: '0.5rem 0', color: 'var(--success)' }}>
            ${billingStats.totalMonthlyRevenue.toLocaleString()}
          </p>
        </div>
        <div className="glass-card">
          <h3 className="text-secondary text-sm">Active Merchants</h3>
          <p style={{ fontSize: '2rem', fontWeight: 600, margin: '0.5rem 0' }}>{billingStats.totalMerchants}</p>
        </div>
        <div className="glass-card">
          <h3 className="text-secondary text-sm">Open Support Tickets</h3>
          <p style={{ fontSize: '2rem', fontWeight: 600, margin: '0.5rem 0', color: 'var(--warning)' }}>{stats.openTickets}</p>
        </div>
      </div>

      {/* Plan & Revenue Breakdown Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }}>
        <div className="glass-card">
          <h3 style={{ marginBottom: '1.5rem' }}>Revenue Breakdown by Plan</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Plan Name</th>
                <th>Merchants</th>
                <th>Price</th>
                <th>Monthly Revenue</th>
              </tr>
            </thead>
            <tbody>
              {billingStats.planDistribution.map((item: any) => {
                const planDetail = billingStats.plans?.find((p: any) => p.name === item.name) || { price: 0 };
                const revenue = item.count * planDetail.price;
                return (
                  <tr key={item.name}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>{item.count}</td>
                    <td>${planDetail.price}/mo</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>${revenue.toLocaleString()}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '2px solid var(--border-light)', background: 'rgba(255,255,255,0.02)' }}>
                <td colSpan={3} style={{ fontWeight: 700 }}>Total Estimated MRR</td>
                <td style={{ color: 'var(--accent-primary)', fontSize: '1.1rem', fontWeight: 700 }}>
                  ${billingStats.totalMonthlyRevenue.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="glass-card">
          <h3 style={{ marginBottom: '1.5rem' }}>Plan Distribution</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {billingStats.planDistribution.map((item: any, index: number) => {
              const percentage = (item.count / billingStats.totalMerchants) * 100;
              const colors = ['#8B5CF6', '#EC4899', '#3B82F6', '#10B981'];
              return (
                <div key={item.name}>
                  <div className="flex-between text-sm mb-2">
                    <span className="flex-center gap-2">
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors[index % colors.length] }} />
                      {item.name}
                    </span>
                    <span className="text-secondary">{percentage.toFixed(0)}% ({item.count})</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${percentage}%`, background: colors[index % colors.length], borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
