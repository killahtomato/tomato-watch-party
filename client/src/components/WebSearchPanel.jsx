import { useState, useCallback, useEffect, useMemo } from 'react';

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
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [modes, setModes] = useState([]);
  const [mode, setMode] = useState('sub');
  const [resolved, setResolved] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [playableKeys, setPlayableKeys] = useState(() => new Set());
  const [probeStatus, setProbeStatus] = useState('idle');

  const run = useCallback((event, data) => new Promise((resolvePromise, rejectPromise) => {
    emit(event, data, (response) => {
      if (response?.error) rejectPromise(new Error(response.error));
      else resolvePromise(response);
    });
  }), [emit]);

  useEffect(() => {
    if (results.length === 0) {
      setPlayableKeys(new Set());
      setProbeStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setProbeStatus('probing');
    run('web:probe', { results })
      .then((response) => {
        if (cancelled) return;
        setPlayableKeys(new Set(Array.isArray(response.playable) ? response.playable : []));
        setProbeStatus('done');
      })
      .catch(() => {
        if (!cancelled) setProbeStatus('error');
      });
    return () => { cancelled = true; };
  }, [results, run]);

  const handleSearch = useCallback(async (e) => {
    e?.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError('');
    setResults([]);
    setSelectedResult(null);
    setEpisodes([]);
    setEpisodeFilter('');
    setSelectedEpisode(null);
    setResolved(null);
    setPlayableKeys(new Set());
    setProbeStatus('idle');
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

  const handleChangeSeries = useCallback(() => {
    setSelectedResult(null);
    setEpisodes([]);
    setEpisodeFilter('');
    setSelectedEpisode(null);
    setResolved(null);
    setModes([]);
    setError('');
  }, []);

  const handlePickResult = useCallback(async (result) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setSelectedResult(result);
    setEpisodes([]);
    setEpisodeFilter('');
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
  const filter = episodeFilter.trim().toLowerCase();
  const filteredEpisodes = filter
    ? episodes.filter((episode) => (
      String(episode.number).toLowerCase().includes(filter)
      || (episode.title || '').toLowerCase().includes(filter)
    ))
    : episodes;

  const sortedResults = useMemo(() => {
    if (probeStatus !== 'done') return results;
    return [...results].sort((a, b) => {
      const aPlayable = playableKeys.has(`${a.source}:${a.id}`) ? 0 : 1;
      const bPlayable = playableKeys.has(`${b.source}:${b.id}`) ? 0 : 1;
      return aPlayable - bPlayable;
    });
  }, [results, playableKeys, probeStatus]);

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

      <div className="web-picker">
        <div className="web-picker-left">
          {!selectedResult ? (
            <div className="web-results">
              {busy && <p className="web-hint">Searching...</p>}
              {!busy && results.length === 0 && <p className="web-hint">Search for a show to get started.</p>}
              {!busy && results.length > 0 && probeStatus === 'probing' && (
                <p className="web-hint">Checking availability...</p>
              )}
              {probeStatus === 'done' && (
                <p className="web-hint">{playableKeys.size} of {results.length} available</p>
              )}
              {sortedResults.map((result) => {
                const key = `${result.source}:${result.id}`;
                const playable = playableKeys.has(key);
                const stateClass = probeStatus === 'done' ? (playable ? 'playable' : 'unavailable') : '';
                return (
                  <button
                    key={key}
                    className={`web-result-item ${selectedResult?.id === result.id ? 'active' : ''} ${stateClass}`}
                    onClick={() => handlePickResult(result)}
                  >
                    <span className="web-result-source">{result.source}</span>
                    <span className="web-result-title">{result.title}</span>
                    {probeStatus === 'done' && (
                      <span className={`web-avail ${playable ? 'yes' : 'no'}`}>
                        {playable ? '✓ Available' : 'Unavailable'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="web-picker-header">
                <button type="button" className="web-back" onClick={handleChangeSeries}>← Change series</button>
                <span className="web-picker-title" title={selectedResult.title}>{selectedResult.title}</span>
              </div>
              <input
                type="text"
                className="web-episode-filter"
                placeholder="Filter episodes..."
                value={episodeFilter}
                onChange={(e) => setEpisodeFilter(e.target.value)}
                disabled={busy}
              />
              <div className="web-episode-grid">
                {filteredEpisodes.length === 0 && <p className="web-hint">No episodes match.</p>}
                {filteredEpisodes.map((episode) => (
                  <button
                    key={episode.key}
                    type="button"
                    className={`web-episode-chip ${selectedEpisode?.key === episode.key ? 'active' : ''}`}
                    onClick={() => handlePickEpisode(episode)}
                    title={episode.title || `Episode ${episode.number}`}
                  >
                    {episode.number}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="web-picker-right">
          {!selectedResult ? (
            <p className="web-hint">Pick a series to see its episodes.</p>
          ) : !selectedEpisode ? (
            <p className="web-hint">Pick an episode to see playback options.</p>
          ) : (
            <div className="web-selected">
              <div className="web-selected-title" title={selectedResult.title}>{selectedResult.title}</div>
              <div className="web-selected-ep">Episode {selectedEpisode.number}</div>

              {modes.length > 0 && (
                <div className="web-opt-row">
                  <span className="web-opt-label">Mode</span>
                  <div className="web-mode-row">
                    {modes.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`web-mode-btn ${mode === m ? 'active' : ''}`}
                        onClick={() => handleModeChange(m)}
                        disabled={busy}
                      >
                        {m === 'dub' ? 'Dub' : 'Sub'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {playableStreams.length > 0 && (
                <div className="web-opt-row">
                  <span className="web-opt-label">Quality</span>
                  <select
                    className="web-quality-select"
                    value={selectedQuality}
                    onChange={(e) => setSelectedQuality(e.target.value)}
                    disabled={busy}
                  >
                    {playableStreams.map((s) => <option key={s.url} value={s.quality}>{s.quality}</option>)}
                  </select>
                </div>
              )}

              <button
                type="button"
                className="web-play-btn"
                onClick={handlePlay}
                disabled={busy || playableStreams.length === 0}
              >
                {busy ? 'Working...' : '▶ Play'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
