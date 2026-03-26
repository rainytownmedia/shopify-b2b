import React, { useState } from 'react';
import { api } from '../api';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const formData = new FormData();
      formData.append('intent', 'login');
      formData.append('email', email);
      formData.append('password', password);

      await api.post('/auth', formData);
      localStorage.setItem('adminAuth', 'true');
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Admin Login</h2>
        
        {error && <div style={{ background: 'var(--danger)', color: 'white', padding: '0.75rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}

        <form style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} onSubmit={handleSubmit}>
          <div>
            <label className="text-secondary text-sm">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '0.75rem', marginTop: '0.25rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }} />
          </div>
          <div>
            <label className="text-secondary text-sm">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', padding: '0.75rem', marginTop: '0.25rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'white' }} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem', padding: '0.75rem' }}>Login</button>
        </form>
      </div>
    </div>
  );
};

export default Login;
