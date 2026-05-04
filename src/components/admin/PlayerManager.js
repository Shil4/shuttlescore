import { useState, useEffect } from 'react';
import { PlayerService } from '../../services/PlayerService';
import './AdminComponents.css';

export default function PlayerManager() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    age_category: 'adult',
    contact_info: '',
  });

  useEffect(() => {
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      setLoading(true);
      const data = await PlayerService.getAll();
      setPlayers(data);
    } catch (err) {
      setError('Failed to load players: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ name: '', age_category: 'adult', contact_info: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (player) => {
    setForm({
      name: player.name,
      age_category: player.age_category || 'adult',
      contact_info: player.contact_info || '',
    });
    setEditingId(player.id);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      // Only send fields that exist in the database
      const payload = {
        name: form.name,
        age_category: form.age_category,
      };
      // Only include contact_info if not empty
      if (form.contact_info.trim()) {
        payload.contact_info = form.contact_info.trim();
      }

      if (editingId) {
        await PlayerService.update(editingId, payload);
      } else {
        await PlayerService.create(payload);
      }
      resetForm();
      await loadPlayers();
    } catch (err) {
      setError('Failed to save player: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this player? Their match history will be lost.')) return;
    try {
      await PlayerService.delete(id);
      await loadPlayers();
    } catch (err) {
      setError('Failed to delete: ' + err.message);
    }
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      // Read and parse CSV
      const text = await file.text();
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });
        // Map to our schema
        if (row.name) {
          rows.push({
            name: row.name,
            age_category: row.age_category || row.category || 'adult',
            contact_info: row.contact_info || row.email || row.phone || '',
          });
        }
      }

      if (rows.length === 0) {
        setError('No valid rows found in CSV. Make sure there is a "name" column.');
        return;
      }

      const result = await PlayerService.importFromCSV(rows);
      alert(`Imported ${result.imported.length} players.${result.errors.length > 0 ? `\n\nErrors:\n${result.errors.join('\n')}` : ''}`);
      await loadPlayers();
    } catch (err) {
      setError('CSV import failed: ' + err.message);
    }

    // Reset file input
    e.target.value = '';
  };

  // Filter players by search
  const filtered = players.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="admin-loading">Loading players...</div>;
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2>Player Registry</h2>
        <div className="admin-header-actions">
          <label className="admin-btn secondary csv-btn">
            📄 Import CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleCSVImport}
              style={{ display: 'none' }}
            />
          </label>
          <button
            className="admin-btn primary"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            + Add Player
          </button>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="admin-form-card">
          <h3>{editingId ? 'Edit Player' : 'Add Player'}</h3>
          <form onSubmit={handleSubmit} className="admin-form">
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Player name"
                  required
                />
              </div>
              <div className="admin-field">
                <label>Age Category</label>
                <select
                  value={form.age_category}
                  onChange={(e) => setForm({ ...form, age_category: e.target.value })}
                >
                  <option value="u8">U-8</option>
                  <option value="u12">U-12</option>
                  <option value="u18">U-18</option>
                  <option value="adult">Adult</option>
                  <option value="senior">Senior (45+)</option>
                </select>
              </div>
            </div>
            <div className="admin-form-row">
              <div className="admin-field">
                <label>Contact Info (optional)</label>
                <input
                  type="text"
                  value={form.contact_info}
                  onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
                  placeholder="Email, phone, or any contact details"
                />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn primary">
                {editingId ? 'Save Changes' : 'Add Player'}
              </button>
              <button type="button" className="admin-btn secondary" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="admin-search">
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="admin-count">{filtered.length} players</span>
      </div>

      {/* Player List */}
      {filtered.length === 0 ? (
        <div className="admin-empty">
          <p>{search ? 'No players match your search.' : 'No players yet. Add one or import a CSV!'}</p>
        </div>
      ) : (
        <div className="admin-list">
          {filtered.map((p) => (
            <div key={p.id} className="admin-list-item">
              <div className="admin-list-main">
                <div className="admin-list-title">{p.name}</div>
                <div className="admin-list-meta">
                  <span className="admin-category-badge">{p.age_category || 'adult'}</span>
                  {p.contact_info && <span>{p.contact_info}</span>}
                </div>
              </div>
              <div className="admin-list-right">
                <button className="admin-btn small" onClick={() => handleEdit(p)}>
                  Edit
                </button>
                <button className="admin-btn small danger" onClick={() => handleDelete(p.id)}>
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