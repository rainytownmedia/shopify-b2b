import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Mail, Calendar, CreditCard, Shield, Activity, BarChart3, AlertCircle } from 'lucide-react';

const ShopDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shop, setShop] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'settings'>('overview');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/shops/${id}`).then(res => {
      setShop(res.data);
    }).finally(() => setLoading(false));
  }, [id]);

  const handleUpdateStatus = (newStatus: string) => {
    setSaving(true);
    api.patch(`/shops/${id}`, { status: newStatus }).then(res => {
       setShop({ ...shop, ...res.data });
    }).finally(() => setSaving(false));
  };

  if (loading) return <div className="p-4 text-secondary">Loading merchant profile...</div>;
  if (!shop) return <div className="p-4 text-danger">Merchant not found.</div>;

  return (
    <div>
      <div className="flex-between mb-4">
        <div className="flex-center gap-2">
          <button className="btn btn-glass p-2" onClick={() => navigate('/merchants')}>
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0 }}>{shop.name || shop.domain}</h1>
          <span className={`badge ${shop.status === 'ACTIVE' ? 'badge-success' : shop.status === 'TRIAL' ? 'badge-info' : 'badge-danger'}`}>
            {shop.status}
          </span>
        </div>
        <div className="flex-center gap-2">
           <button 
             className="btn btn-glass" 
             onClick={() => handleUpdateStatus(shop.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}
             disabled={saving}
           >
             {shop.status === 'SUSPENDED' ? 'Activate Store' : 'Suspend Store'}
           </button>
           <button className="btn btn-primary" onClick={() => navigate(`/shops/${id}/logs`)}>View Full Logs</button>
        </div>
      </div>

      <div className="glass mb-4" style={{ display: 'flex', gap: '2rem', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
        <button onClick={() => setActiveTab('overview')} className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}>Overview</button>
        <button onClick={() => setActiveTab('usage')} className={`tab-btn ${activeTab === 'usage' ? 'active' : ''}`}>Usage & Quotas</button>
        <button onClick={() => setActiveTab('settings')} className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}>Plan Settings</button>
      </div>

      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          <div className="glass-card">
            <h3 className="mb-3 flex-center gap-2"><Mail size={18} /> Contact Information</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Domain</div>
                <div>{shop.domain}</div>
              </div>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Email</div>
                <div>{shop.email || 'No email provided'}</div>
              </div>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Installed At</div>
                <div className="flex-center gap-1"><Calendar size={14} /> {new Date(shop.installedAt).toLocaleDateString()}</div>
              </div>
            </div>
          </div>

          <div className="glass-card">
            <h3 className="mb-3 flex-center gap-2"><CreditCard size={18} /> Subscription Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Current Plan</div>
                <div style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--accent-primary)' }}>{shop.plan}</div>
              </div>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Billing Status</div>
                <div className="flex-center gap-1">
                   <Shield size={14} className={shop.subscriptionStatus === 'ACTIVE' ? 'text-success' : 'text-warning'} />
                   {shop.subscriptionStatus}
                </div>
              </div>
              <div>
                <div className="text-secondary text-xs uppercase font-bold">Installation Status</div>
                <div className={`badge ${shop.isActive ? 'badge-success' : 'badge-danger'}`}>
                   {shop.isActive ? 'Installed' : 'Uninstalled'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'usage' && (
        <div className="glass-card">
          <h3 className="mb-3 flex-center gap-2"><BarChart3 size={18} /> Usage Statistics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            <div className="p-3 glass" style={{ textAlign: 'center' }}>
               <div className="text-secondary text-xs mb-1">Price Lists</div>
               <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{shop.usage.priceLists}</div>
            </div>
            <div className="p-3 glass" style={{ textAlign: 'center' }}>
               <div className="text-secondary text-xs mb-1">Cart Discounts</div>
               <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{shop.usage.cartDiscounts}</div>
            </div>
            <div className="p-3 glass" style={{ textAlign: 'center' }}>
               <div className="text-secondary text-xs mb-1">Checkout Rules</div>
               <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{shop.usage.checkoutRules}</div>
            </div>
          </div>

          <div className="mt-4 p-4 glass" style={{ borderRadius: 'var(--radius-md)' }}>
            <div className="flex-between mb-2">
               <span className="font-bold">Total Rule Usage</span>
               <span className="text-secondary">{shop.usage.totalRules} / {shop.maxRowLimit} items</span>
            </div>
            <div style={{ height: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '5px', overflow: 'hidden' }}>
               <div style={{ 
                 height: '100%', 
                 width: `${Math.min(100, (shop.usage.totalRules / shop.maxRowLimit) * 100)}%`, 
                 background: (shop.usage.totalRules / shop.maxRowLimit) > 0.9 ? 'var(--danger)' : 'var(--accent-primary)' 
               }} />
            </div>
            {(shop.usage.totalRules / shop.maxRowLimit) > 0.8 && (
               <div className="flex-center gap-1 text-danger text-xs mt-2">
                 <AlertCircle size={12} /> Merchant is approaching their plan limit.
               </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="glass-card">
           <h3 className="mb-3">Manual Plan Overrides</h3>
           <p className="text-secondary text-sm mb-4">Use these settings to manually adjust plan limits or override the billing tier for this specific merchant.</p>
           
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <label className="form-label">Plan Tier</label>
                <select 
                  className="form-control" 
                  value={shop.plan}
                  onChange={(e) => setShop({...shop, plan: e.target.value})}
                >
                  <option value="Free">Free</option>
                  <option value="Pro">Pro</option>
                  <option value="Unlimited">Unlimited</option>
                </select>
              </div>
              <div>
                <label className="form-label">Max Rule Limit (Rows)</label>
                <input 
                  type="number" 
                  className="form-control" 
                  value={shop.maxRowLimit}
                  onChange={(e) => setShop({...shop, maxRowLimit: parseInt(e.target.value)})}
                />
              </div>
           </div>

           <div className="mt-4 flex-end">
              <button 
                className="btn btn-primary" 
                disabled={saving}
                onClick={() => {
                   setSaving(true);
                   api.patch(`/shops/${id}`, { 
                     plan: shop.plan, 
                     maxRowLimit: shop.maxRowLimit 
                   }).finally(() => setSaving(false));
                }}
              >
                Save Manual Override
              </button>
           </div>
        </div>
      )}

      <style>{`
        .tab-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          padding: 1rem 0;
          cursor: pointer;
          font-weight: 500;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
        }
        .tab-btn:hover {
          color: var(--text-primary);
        }
        .tab-btn.active {
          color: var(--accent-primary);
          border-bottom-color: var(--accent-primary);
        }
        .text-success { color: var(--success); }
        .text-warning { color: var(--warning); }
      `}</style>
    </div>
  );
};

export default ShopDetail;
