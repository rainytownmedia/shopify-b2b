import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { MessageSquare, Clock, CheckCircle2, AlertCircle, Eye } from 'lucide-react';

const TicketsList = () => {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = () => {
    setLoading(true);
    api.get('/support').then(res => {
      setTickets(res.data);
    }).finally(() => setLoading(false));
  };

  const handleUpdateStatus = (id: string, newStatus: string) => {
    api.patch('/support', { id, status: newStatus }).then(() => {
      fetchTickets();
      if (selectedTicket?.id === id) {
        setSelectedTicket({ ...selectedTicket, status: newStatus });
      }
    });
  };

  if (loading) return <div className="p-4 text-secondary">Loading tickets...</div>;

  return (
    <div>
      <div className="flex-between mb-4">
        <h1>Support Tickets & Feedback</h1>
        <button className="btn btn-glass" onClick={fetchTickets}>Refresh</button>
      </div>

      <div className="glass-card p-0 overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Subject</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }} className="text-secondary">No tickets found.</td></tr>
            ) : (
              tickets.map(ticket => (
                <tr key={ticket.id}>
                  <td>{ticket.shopId}</td>
                  <td>{ticket.subject}</td>
                  <td>
                    <span className={`badge ${ticket.priority === 'high' ? 'badge-danger' : 'badge-info'}`}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${ticket.status === 'open' ? 'badge-warning' : 'badge-success'}`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td>{new Date(ticket.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-glass btn-sm" onClick={() => setSelectedTicket(ticket)}>
                      <Eye size={14} /> View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ maxWidth: '600px' }}>
            <div className="flex-between mb-4">
              <h2 className="flex-center gap-2"><MessageSquare /> Ticket Details</h2>
              <button className="close-btn" onClick={() => setSelectedTicket(null)}>&times;</button>
            </div>
            
            <div className="mb-4">
              <div className="text-secondary text-xs uppercase font-bold mb-1">From Shop</div>
              <div className="font-bold">{selectedTicket.shopId}</div>
            </div>

            <div className="mb-4">
              <div className="text-secondary text-xs uppercase font-bold mb-1">Subject</div>
              <div style={{ fontSize: '1.2rem' }}>{selectedTicket.subject}</div>
            </div>

            <div className="mb-4 p-3 glass" style={{ minHeight: '100px', borderRadius: 'var(--radius-sm)' }}>
              <div className="text-secondary text-xs uppercase font-bold mb-2">Description</div>
              <div>{selectedTicket.description}</div>
            </div>

            <div className="flex-between mt-4 pt-4 border-t border-glass">
              <div className="flex-center gap-2 text-sm text-secondary">
                <Clock size={14} /> Created {new Date(selectedTicket.createdAt).toLocaleString()}
              </div>
              <div className="flex-center gap-2">
                {selectedTicket.status === 'open' ? (
                  <button className="btn btn-success flex-center gap-1" onClick={() => handleUpdateStatus(selectedTicket.id, 'closed')}>
                    <CheckCircle2 size={16} /> Mark as Resolved
                  </button>
                ) : (
                  <button className="btn btn-warning flex-center gap-1" onClick={() => handleUpdateStatus(selectedTicket.id, 'open')}>
                    <AlertCircle size={16} /> Reopen Ticket
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          width: 90%;
          padding: 2rem;
        }
        .border-t { border-top: 1px solid rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
};

export default TicketsList;
