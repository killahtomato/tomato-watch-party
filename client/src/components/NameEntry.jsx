import { useState } from 'react';

export default function NameEntry({ onSubmit, connected }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="name-entry">
      <div className="name-entry-box">
        <h1>Movie Stream</h1>
        <p className="subtitle">Join the audience</p>

        {!connected && <p className="conn-status offline">Connecting to server...</p>}
        {connected && <p className="conn-status online">Connected</p>}

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            maxLength={24}
            autoFocus
          />
          <button type="submit" disabled={!name.trim() || !connected}>
            Join
          </button>
        </form>
      </div>
    </div>
  );
}
