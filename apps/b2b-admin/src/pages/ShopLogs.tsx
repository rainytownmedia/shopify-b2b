import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ArrowLeft, Clock, Globe, Code } from 'lucide-react';

const ShopLogs = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [shop, setShop] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    // Fetch shop details for name
    api.get(`/shops/${id}`).then(res => setShop(res.data)).catch(console.error);
    
    // Fetch logs
    api.get(`/shops/${id}/logs`).then(res => {
      setLogs(res.data);
    }).finally(() => setLoading(false));
  }, [id]);

  const formatJSON = (json: string | null) => {
    if (!json) return 'None';
    try {
      const obj = JSON.parse(json);
      return JSON.stringify(obj, null, 2);
    } catch {
      return json;
    }
  };

  return (
    <div>
      <div className="flex-between mb-4">
        <div className="flex-center gap-2">
          <button className="btn btn-glass p-2" onClick={() => navigate('/merchants')}>
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ margin: 0 }}>Activity Logs: {shop?.name || id}</h1>
        </div>
      </div>

      <div className="glass-card p-0" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Method</th>
              <th>Status</th>
              <th>Duration</th>
              <th>IP</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-4">Loading logs...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-4">No activity recorded yet.</td></tr>
            ) : logs.map(log => (
              <tr key={log.id}>
                <td className="text-sm">
                   <div className="flex-center gap-1 text-secondary">
                      <Clock size={12} />
                      {new Date(log.createdAt).toLocaleString()}
                   </div>
                </td>
                <td><span className="badge">{log.action}</span></td>
                <td><code style={{ color: 'var(--accent-secondary)' }}>{log.method}</code></td>
                <td>
                   <span className={`badge ${log.statusCode < 400 ? 'badge-success' : 'badge-danger'}`}>
                      {log.statusCode}
                   </span>
                </td>
                <td className="text-sm text-secondary">{log.duration}ms</td>
                <td className="text-sm text-secondary">{log.ip}</td>
                <td>
                  <button className="btn btn-glass btn-sm" onClick={() => setSelectedLog(log)}>View Data</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="flex-between mb-3">
              <h2 style={{ margin: 0 }}>Log Details</h2>
              <button className="btn btn-glass btn-sm" onClick={() => setSelectedLog(null)}>Close</button>
            </div>
            
            <div className="mb-3 p-3 glass" style={{ borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
               <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem' }}>
                  <span className="text-secondary">Path:</span>
                  <span style={{ wordBreak: 'break-all' }}>{selectedLog.path}</span>
                  <span className="text-secondary">Method:</span>
                  <span style={{ fontWeight: 600 }}>{selectedLog.method}</span>
                  <span className="text-secondary">Status:</span>
                  <span style={{ fontWeight: 600 }}>{selectedLog.statusCode}</span>
               </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', height: '400px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className="text-sm font-bold flex-center gap-1"><Globe size={14} /> Request Data</span>
                <pre className="glass p-3 text-xs" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
                  {formatJSON(selectedLog.requestData)}
                </pre>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className="text-sm font-bold flex-center gap-1"><Code size={14} /> Response Data</span>
                <pre className="glass p-3 text-xs" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
                  {formatJSON(selectedLog.responseData)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopLogs;
