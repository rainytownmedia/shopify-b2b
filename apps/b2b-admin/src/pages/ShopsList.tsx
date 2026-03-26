import React, { useEffect, useState } from 'react';
import { api } from '../api';

const ShopsList = () => {
  const [shops, setShops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, { connected: boolean, message: string }>>({});

  const fetchShops = () => {
    setLoading(true);
    api.get('/shops').then(res => {
      setShops(res.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchShops();
  }, []);

  const handleVerify = (id: string) => {
    setVerifying(id);
    api.get(`/shops/${id}/verify`).then(res => {
      setStatuses(prev => ({ ...prev, [id]: res }));
    }).catch(err => {
      setStatuses(prev => ({ ...prev, [id]: { connected: false, message: 'Check failed' } }));
    }).finally(() => setVerifying(null));
  };

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>Installed Merchants</h1>
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }} className="text-secondary">Loading shops...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>Domain</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>Plan</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>App Status</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>API Status</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.map(shop => (
                <tr key={shop.id} style={{ borderBottom: '1px solid var(--border-light)', transition: 'background 0.2s' }}>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 600 }}>{shop.name || shop.domain}</div>
                    <div className="text-secondary text-xs">{shop.domain}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>{shop.plan}</td>
                  <td style={{ padding: '1rem' }}>
                    <span className={`badge ${shop.isActive ? 'badge-success' : 'badge-danger'}`}>
                      {shop.isActive ? 'Active' : 'Uninstalled'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {statuses[shop.id] ? (
                       <span className={`badge ${statuses[shop.id].connected ? 'badge-success' : 'badge-danger'}`} title={statuses[shop.id].message}>
                          {statuses[shop.id].connected ? 'Connected' : 'Error'}
                       </span>
                    ) : (
                       <span className="text-secondary text-sm">Not checked</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div className="flex-center gap-2">
                      <button 
                        className="btn btn-glass btn-sm" 
                        onClick={() => handleVerify(shop.id)}
                        disabled={verifying === shop.id}
                      >
                        {verifying === shop.id ? '...' : 'Verify'}
                      </button>
                      <a href={`/merchants/${shop.id}`} className="btn btn-glass btn-sm" style={{ textDecoration: 'none' }}>Manage</a>
                    </div>
                  </td>
                </tr>
              ))}
              {shops.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '2rem', textAlign: 'center' }} className="text-secondary">No merchants found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ShopsList;
