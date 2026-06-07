import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, ArrowRight, HelpCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { GuessResponse } from './types';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessResponse[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    initGame();
  }, []);

  const initGame = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/new-game', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.sessionId);
      setGuesses([]);
      setHintsUsed(0);
      setWin(false);
      setSecret(null);
      setError(null);
    } catch (e: any) {
      setError('Failed to start new game');
    } finally {
      setLoading(false);
    }
  };

  const handleGuess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !sessionId || loading || win) return;

    const word = inputValue.trim();
    setInputValue('');
    
    // Check if already guessed
    if (guesses.some(g => g.word.toLowerCase() === word.toLowerCase())) {
      return; 
    }

    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, word })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.rank === 1) {
        setWin(true);
        setSecret(data.word);
      }
      
      setGuesses(prev => {
        const next = [...prev, data];
        return next.sort((a, b) => a.rank - b.rank);
      });
    } catch (e: any) {
      setError(e.message || 'Error making guess');
    } finally {
      setLoading(false);
    }
  };

  const getMaxHints = (guessCount: number) => {
    if (guessCount >= 20) return 2;
    if (guessCount >= 10) return 1;
    return 0;
  };

  const handleHint = async () => {
    if (!sessionId || hintsUsed >= getMaxHints(guesses.length) || win || loading) return;

    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setHintsUsed(val => val + 1);
      
      setGuesses(prev => {
        if (prev.some(g => g.word.toLowerCase() === data.hint.toLowerCase())) return prev;
        const next = [...prev, { word: data.hint, rank: data.rank }];
        return next.sort((a, b) => a.rank - b.rank);
      });
    } catch (e: any) {
      setError(e.message || 'Error getting hint');
    } finally {
      setLoading(false);
    }
  };

  const handleGiveUp = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/giveup?sessionId=${sessionId}`);
      const data = await res.json();
      setSecret(data.secret);
      setWin(true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const getColorClass = (rank: number) => {
    if (rank <= 500) return 'bg-green-900 border-green-500 text-green-400';
    if (rank <= 1500) return 'bg-yellow-900 border-yellow-500 text-yellow-400';
    return 'bg-red-950 border-red-500 text-red-500';
  };

  return (
    <div className="min-h-screen bg-[#050505] text-green-400 font-sans p-4 sm:p-8 flex flex-col items-center crt-flicker">
      <div className="scanlines"></div>
      <div className="w-full max-w-xl mx-auto space-y-6 relative z-10">
        <header className="text-center space-y-2 mt-4 mb-8">
          <h1 className="text-6xl sm:text-7xl font-bold text-green-500 flex items-center justify-center gap-3 tracking-widest drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]">
            <span className="text-green-400">[&gt;]</span> SYS_SCAN
          </h1>
          <p className="text-green-600/80 text-xl tracking-wider uppercase">Isolate the encoded memory block</p>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-md flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {win ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-900/30 border border-green-500 p-6 rounded flex flex-col items-center text-center space-y-4 shadow-[0_0_15px_rgba(34,197,94,0.2)]"
          >
            <h2 className="text-3xl font-medium text-green-400 uppercase tracking-widest">Target Isolated</h2>
            <p className="text-xl text-green-600">The sector contained <strong className="text-green-300 text-3xl ml-2 uppercase animate-pulse">"{secret}"</strong></p>
            <p className="text-lg text-green-500/80">Decrypted in {guesses.length} attempts.</p>
            <button 
              onClick={initGame}
              className="mt-4 px-6 py-3 bg-green-900/50 hover:bg-green-800 border border-green-500 text-green-400 text-2xl rounded transition-all inline-flex items-center gap-2 tracking-widest uppercase hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]"
            >
              <RefreshCw className="w-6 h-6" /> Reboot System
            </button>
          </motion.div>
        ) : (
          <form onSubmit={handleGuess} className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="ENTER_QUERY..."
              disabled={loading || !sessionId}
              className="flex-1 bg-black border border-green-700/50 rounded px-4 py-3 placeholder-green-800 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all text-3xl tracking-widest disabled:opacity-50 text-green-400 uppercase"
            />
            <button 
              type="submit" 
              disabled={loading || !sessionId || !inputValue.trim()}
              className="px-6 bg-green-900/40 border border-green-700/50 hover:bg-green-800 hover:border-green-500 disabled:bg-black disabled:text-green-900 text-green-400 rounded transition-all flex items-center justify-center uppercase disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-8 h-8 animate-spin" /> : <ArrowRight className="w-8 h-8" />}
            </button>
          </form>
        )}

        <div className="flex justify-between items-center py-2 border-b border-green-900/50 pb-4">
          <span className="text-green-600/80 text-xl tracking-widest uppercase">Scans: {guesses.length}</span>
          
          <div className="flex items-center gap-4">
            {!win && guesses.length > 0 && (
              <button 
                onClick={handleGiveUp}
                className="text-red-600/60 hover:text-red-500 transition-colors uppercase tracking-widest text-lg"
              >
                Abort
              </button>
            )}
            {!win && guesses.length >= 10 && hintsUsed < getMaxHints(guesses.length) && (
              <button
                onClick={handleHint}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-900/40 border border-green-500/50 text-green-400 hover:bg-green-800 hover:border-green-500 rounded transition-all disabled:opacity-50 text-xl uppercase tracking-widest"
              >
                <HelpCircle className="w-5 h-5" /> 
                Ping ({getMaxHints(guesses.length) - hintsUsed})
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2 relative pb-20">
          <AnimatePresence>
            {guesses.map((g) => (
              <motion.div
                key={g.word}
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                layout
                className={`relative overflow-hidden rounded w-full flex items-center justify-between px-4 text-xl h-14 border-l-4 ${getColorClass(g.rank)}`}
              >
                <span className="tracking-widest uppercase truncate mr-4 text-2xl">
                  {g.word}
                </span>
                <span className="opacity-90 text-2xl tracking-widest">
                  {g.rank.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {guesses.length === 0 && !loading && !win && (
            <div className="text-center text-green-800 py-16 px-4 uppercase tracking-widest border border-dashed border-green-900/50 rounded-lg">
              Awaiting payload... Scan sequence offline.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
