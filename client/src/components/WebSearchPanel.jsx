import { useState, useCallback } from 'react';

const SOURCES = [
  ['all', 'All sources'],
  ['aniwatch', 'aniwatch'],
  ['gogoanime', 'gogoanime'],
  ['9anime', '9anime'],
  ['hianime', 'hianime'],
  ['miruro', 'miruro'],
  ['animegg', 'animegg'],
  ['bilibili', 'bilibili'],
  ['youtube', 'youtube'],
  ['nyaa', 'nyaa'],
  ['tpb', 'tpb'],
];

export default function WebSearchPanel({ emit, isHost, onPlay }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [results, setResults] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [modes, setModes] = useState([]);
  const [mode, setMode] = useState('sub');
  const [resolved, setResolved] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback((event, data) => new Promise((resolvePromise, rejectPromise) => {
    emit(event, data, (response) => {
      if (response?.error) rejectPromise(new Error(response.error));
      else resolvePromise(response);
    });
  }), [emit]);

  const handleSearch = useCallback(async (e) => {
    e?.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError('');
    setResults([]);
    setSelectedResult(null);
    setEpisodes([]);
    setSelectedEpisode(null);
    setResolved(null);
    try {
      const response = await run('web:search', { q: query.trim(), source });
      setResults(response.results || []);
      if ((response.results || []).length === 0) setError('No results found.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [query, source, busy, run]);

  const handlePickResult = useCallback(async (result) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSelectedResult(result);
    setEpisodes([]);
    setSelectedEpisode(null);
    setResolved(null);
    setModes([]);
    try {
      const response = await run('web:episodes', { source: result.source, id: result.id });
      const list = response.episodes || [];
      setEpisodes(list);
      if (list.length === 0) setError('No episodes found for that pick.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [busy, run]);

  const handlePickEpisode = useCallback(async (episode) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSelectedEpisode(episode);
    setResolved(null);
    setModes([]);
    try {
      let supported = ['sub'];
      try {
        const modeResponse = await run('web:audio-modes', {
          source: selectedResult.source,
          id: selectedResult.id,
          ep: episode.number,
        });
        supported = modeResponse.modes || supported;
      } catch {}
      setModes(supported);
      setMode('sub');

      const response = await run('web:resolve', {
        source: selectedResult.source,
        id: selectedResult.id,
        ep: episode.key,
        mode: 'sub',
      });
      const streams = (response.streams || []).filter((s) => s.playable !== false);
      setResolved({ ...response, streams });
      setSelectedQuality(streams.length > 0 ? streams[0].quality : '');
      if (streams.length === 0) setError('No directly playable streams for that episode.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [busy, run, selectedResult]);

  const handleModeChange = useCallback(async (nextMode) => {
    if (!selectedResult || !selectedEpisode) return;
    setMode(nextMode);
    setBusy(true);
    setError('');
    try {
      const response = await run('web:resolve', {
        source: selectedResult.source,
        id: selectedResult.id,
        ep: selectedEpisode.key,
        mode: nextMode,
      });
      const streams = (response.streams || []).filter((s) => s.playable !== false);
      setResolved({ ...response, streams });
      setSelectedQuality(streams.length > 0 ? streams[0].quality : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [selectedResult, selectedEpisode, run]);

  const handlePlay = useCallback(() => {
    if (!selectedResult || !selectedEpisode || !resolved) return;
    const stream = resolved.streams.find((s) => s.quality === selectedQuality) || resolved.streams[0];
    if (!stream) return;
    onPlay({
      source: selectedResult.source,
      id: selectedResult.id,
      title: `${selectedResult.title} — Episode ${selectedEpisode.number}`,
      episodeKey: selectedEpisode.key,
      episodeNumber: String(selectedEpisode.number),
      mode,
      quality: stream.quality,
      type: stream.type,
      proxyUrl: stream.proxyUrl,
      referrer: stream.referrer,
      origin: stream.origin,
      live: false,
    });
  }, [selectedResult, selectedEpisode, resolved, selectedQuality, mode, onPlay]);

  if (!isHost) return null;

  const playableStreams = resolved?.streams || [];

  return (
    <div className="web-search-panel">
      <form className="web-search-form" onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          placeholder="Search anime, movies, TV..."
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} disabled={busy}>
          {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" disabled={busy || !query.trim()}>Search</button>
      </form>

      {error && <p className="web-search-error">{error}</p>}
      {busy && <p className="web-search-busy">Working...</p>}

      {results.length > 0 && (
        <div className="web-search-results">
          {results.map((result) => (
            <button
              key={`${result.source}:${result.id}`}
              className={`web-result-item ${selectedResult?.id === result.id ? 'active' : ''}`}
              onClick={() => handlePickResult(result)}
            >
              <span className="web-result-source">{result.source}</span>
              <span className="web-result-title">{result.title}</span>
            </button>
          ))}
        </div>
      )}

      {episodes.length > 0 && (
        <div className="web-episode-list">
          {episodes.map((episode) => (
            <button
              key={episode.key}
              className={`web-episode-item ${selectedEpisode?.key === episode.key ? 'active' : ''}`}
              onClick={() => handlePickEpisode(episode)}
            >
              <span className="web-episode-number">EP {episode.number}</span>
              <span className="web-episode-title">{episode.title}</span>
            </button>
          ))}
        </div>
      )}

      {selectedEpisode && modes.length > 0 && (
        <div className="web-mode-row">
          {modes.map((m) => (
            <button
              key={m}
              className={`web-mode-btn ${mode === m ? 'active' : ''}`}
              onClick={() => handleModeChange(m)}
            >
              {m === 'dub' ? 'Dub' : 'Sub'}
            </button>
          ))}
        </div>
      )}

      {playableStreams.length > 0 && (
        <div className="web-play-row">
          <select value={selectedQuality} onChange={(e) => setSelectedQuality(e.target.value)}>
            {playableStreams.map((s) => <option key={s.url} value={s.quality}>{s.quality}</option>)}
          </select>
          <button className="web-play-btn" onClick={handlePlay}>Play</button>
        </div>
      )}
    </div>
  );
}
