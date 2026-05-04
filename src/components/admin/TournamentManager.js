import { useState, useEffect } from 'react';
import { TournamentService } from '../../services/TournamentService';
import './AdminComponents.css';

export default function TournamentManager() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    venue: '',
    start_date: '',
    end_date: '',
    status: 'draft',
  });

  // Load tournaments
  useEffect(() => {
    loadTournaments();
  }, []);

  const loadTournaments = async () => {
    try {
      setLoading(true);
      const data = await TournamentService.getAll();
      setTournaments(data);
    } catch (err) {
      setError('Failed to load tournaments: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', venue: '', start_date: '', end_date: '', status: 'draft' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (tournament) => {
    setForm({
      name: tournament.name,
      venue: tournament.venue || '',
      start_date: tournament.start_date || '',
      end_date: tournament.end_date || '',
      status: tournament.status,
    });
    setEditingId(tournament.id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate dates
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
      setError('Start date cannot be after end date.');
      return;
    }

    try {
      if (editingId) {
        await TournamentService.update(editingId, form);
      } else {
        await TournamentService.create(form);
      }
      resetForm();
      await loadTournaments();
    } catch (err) {
      setError('Failed to save tournament: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this tournament? This cannot be undone.')) return;
    try {
      await TournamentService.delete(id);
      await loadTournaments();
    } catch (err) {
      setError('Failed to delete: ' + err.message);
    }
  };

  const statusColor = (status) => {
    switch (status) {
      case 'draft': return '#888';
      case 'in_progress': return '#4ecb71';
      case 'completed': return '#d4a843';
      default: return '#888';
    }
  };

  if (loading) {
    return <div className="admin-loading">Loading tournaments...</div>;
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Tournaments</h2>
        <button
          className="admin-btn primary"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          + New Tournament
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="admin-form-card">
          <h3>{editingId ? 'Edit Tournament' : 'New Tournament'}</h3>
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Tournament Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Shuttle Masters 2026"
                  required
                />
              </div>
              <div className="admin-field">
                <label>Venue</label>
                <input
                  type="text"
                  value={form.venue}
                  onChange={(e) => setForm({ ...form, venue: e.target.value })}
                  placeholder="e.g. KV Gymnasium, Kochi"
                />
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label>End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="draft">Draft</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">
                {editingId ? 'Save Changes' : 'Create Tournament'}
              </button>
              <button type="button" className="admin-btn secondary" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tournament List */}
      {tournaments.length === 0 && !showForm ? (
        <div className="admin-empty">
          <p>No tournaments yet. Create your first one!</p>
        </div>
      ) : (
        <div className="admin-list">
          {tournaments.map((t) => (
            <div key={t.id} className="admin-list-item">
              <div className="admin-list-main">
                <div className="admin-list-title">{t.name}</div>
                <div className="admin-list-meta">
                  {t.venue && <span>{t.venue}</span>}
                  {t.start_date && (
                    <span>
                      {t.start_date}
                      {t.end_date && t.end_date !== t.start_date ? ` → ${t.end_date}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="admin-list-right">
                <span
                  className="admin-status-badge"
                  style={{ color: statusColor(t.status), borderColor: statusColor(t.status) }}
                >
                  {t.status.replace('_', ' ')}
                </span>
                <button className="admin-btn small" onClick={() => handleEdit(t)}>
                  Edit
                </button>
                <button
                  className="admin-btn small danger"
                  onClick={() => handleDelete(t.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}