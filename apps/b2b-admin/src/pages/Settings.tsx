import React, { useEffect, useState } from 'react';
import { api } from '../api';

const Settings = () => {
  const [config, setConfig] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/config').then(res => setConfig(res.data)).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/config', config);
      alert('Settings saved!');
    } catch (e) {
      alert('Failed to save settings');
    }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: '2rem' }} className="text-secondary">Loading...</div>;

  return (
    <div style={{ maxWidth: '800px' }}>
      <div className="flex-between" style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Global Settings</h1>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <label className="text-secondary text-sm" style={{ display: 'block', marginBottom: '0.5rem' }}>App Support Email</label>
          <input 
            type="email" 
            value={config.supportEmail || ''} 
            onChange={e => setConfig({...config, supportEmail: e.target.value})}
            style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }} 
          />
        </div>
        
        <div>
          <label className="text-secondary text-sm" style={{ display: 'block', marginBottom: '0.5rem' }}>Enable B2B Features Globally</label>
          <select 
            value={config.b2bEnabled !== false ? 'true' : 'false'}
            onChange={e => setConfig({...config, b2bEnabled: e.target.value === 'true'})}
            style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default Settings;
