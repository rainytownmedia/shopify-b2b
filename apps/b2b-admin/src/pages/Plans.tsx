import React, { useEffect, useState } from 'react';
import { api } from '../api';

const Plans = () => {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '0',
    interval: 'EVERY_30_DAYS',
    isActive: true,
    features: '' // Comma separated for the UI
  });

  const fetchPlans = () => {
    setLoading(true);
    api.get('/plans').then(res => setPlans(res.data)).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleOpenModal = (plan: any = null) => {
    if (plan) {
      setEditingPlan(plan);
      setFormData({
        name: plan.name,
        description: plan.description || '',
        price: plan.price.toString(),
        interval: plan.interval,
        isActive: plan.isActive,
        features: Array.isArray(JSON.parse(plan.features || '[]')) 
          ? JSON.parse(plan.features).join(', ') 
          : ''
      });
    } else {
      setEditingPlan(null);
      setFormData({
        name: '',
        description: '',
        price: '0',
        interval: 'EVERY_30_DAYS',
        isActive: true,
        features: ''
      });
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      features: formData.features.split(',').map(f => f.trim()).filter(f => f),
      id: editingPlan?.id
    };

    try {
      if (editingPlan) {
        await api.patch('/plans', data);
      } else {
        await api.post('/plans', data);
      }
      setShowModal(false);
      fetchPlans();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save plan');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this plan?')) return;
    try {
      await api.delete('/plans', { data: { id } });
      fetchPlans();
    } catch (err) {
      alert('Failed to delete plan');
    }
  };

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Billing Plans</h1>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>+ Create Plan</button>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {loading ? <p className="text-secondary">Loading plans...</p> : plans.map(plan => (
          <div key={plan.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="flex-between">
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{plan.name}</h3>
              <span className={`badge ${plan.isActive ? 'badge-success' : 'badge-danger'}`}>
                {plan.isActive ? 'Active' : 'Draft'}
              </span>
            </div>
            
            <p className="text-secondary text-sm" style={{ margin: 0, flex: 1 }}>{plan.description || 'No description provided.'}</p>
            
            <div style={{ margin: '0.5rem 0' }}>
               <p className="text-sm" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Features:</p>
               <ul style={{ paddingLeft: '1.2rem', margin: 0, fontSize: '0.85rem' }} className="text-secondary">
                  {JSON.parse(plan.features || '[]').map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
               </ul>
            </div>

            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <span style={{ fontSize: '1.75rem', fontWeight: 700 }}>${plan.price}</span>
                <span className="text-secondary text-sm"> / {plan.interval === 'EVERY_30_DAYS' ? 'month' : 'year'}</span>
              </div>
              <div className="flex-center gap-2">
                 <button className="btn btn-glass" onClick={() => handleOpenModal(plan)}>Edit</button>
                 <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(plan.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        {!loading && plans.length === 0 && <p className="text-secondary">No plans configured.</p>}
      </div>

      {/* Plan Editor Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ marginBottom: '1.5rem' }}>{editingPlan ? 'Edit Plan' : 'Create New Plan'}</h2>
            <form onSubmit={handleSave}>
              <div className="mb-4">
                <label>Plan Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Pro Plan" />
              </div>
              
              <div className="mb-4">
                <label>Description</label>
                <textarea rows={3} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Describe what this plan offers..." />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }} className="mb-4">
                <div>
                  <label>Price (USD)</label>
                  <input type="number" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div>
                  <label>Interval</label>
                  <select value={formData.interval} onChange={e => setFormData({...formData, interval: e.target.value})}>
                    <option value="EVERY_30_DAYS">Monthly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
              </div>

              <div className="mb-4">
                <label>Features (comma separated)</label>
                <textarea rows={2} value={formData.features} onChange={e => setFormData({...formData, features: e.target.value})} placeholder="Unlimited Rules, Priority Support, 10GB Data" />
              </div>

              <div className="mb-4" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} style={{ width: 'auto' }} />
                <label style={{ margin: 0 }}>Active / Visible to Merchants</label>
              </div>

              <div className="flex-between mt-4" style={{ paddingTop: '1.5rem', borderTop: '1px solid var(--border-light)' }}>
                <button type="button" className="btn btn-glass" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingPlan ? 'Update Plan' : 'Create Plan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Plans;
