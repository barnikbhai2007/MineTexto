import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, ArrowRight, HelpCircle, AlertCircle, RefreshCw, Users, User } from 'lucide-react';
import { GuessResponse } from './types';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [guesses, setGuesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);

  // Cooldown states
  const [lastGuessTime, setLastGuessTime] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Multiplayer states
  const [socket, setSocket] = useState<Socket | null>(null);
  const [mode, setMode] = useState<'menu' | 'single' | 'multi'>('menu');
  const [gameId, setGameId] = useState('');
  const [players, setPlayers] = useState<any[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [myNumber, setMyNumber] = useState<number | null>(null);

  useEffect(() => {
    initGame();
  }, []);

  useEffect(() => {
    let interval: any;
    if (cooldownRemaining > 0) {
      interval = setInterval(() => {
        const remaining = 10000 - (Date.now() - lastGuessTime);
        if (remaining <= 0) {
          setCooldownRemaining(0);
        } else {
          setCooldownRemaining(Math.ceil(remaining / 1000));
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [cooldownRemaining, lastGuessTime]);

  useEffect(() => {
    if (mode === 'multi' && !socket) {
      const newSocket = io();
      setSocket(newSocket);

      newSocket.on("game_updated", (data) => {
        setPlayers(data.players);
        setGameStarted(data.started);
        setGameId(data.gameId);
        const me = data.players.find((p: any) => p.id === newSocket.id);
        if (me) setMyNumber(me.number);
      });

      newSocket.on("game_started", () => {
        setGameStarted(true);
      });

      newSocket.on("game_restarted", () => {
        setGameEnded(false);
        setWin(false);
        setSecret(null);
        setWinner(null);
        setGuesses([]);
        setGameStarted(true);
      });

      newSocket.on("guess_result", (data) => {
        setLoading(false);
        if (data.rank === 1) {
          setWin(true);
        }
        setGuesses(prev => {
          if (prev.some(g => g.word === data.word)) return prev;
          const newGuess = { word: data.word, rank: data.rank, explanation: data.explanation, isLatest: true };
          return [newGuess, ...prev.map(g => ({ ...g, isLatest: false }))];
        });
      });

      newSocket.on("game_ended", (data) => {
        setGameEnded(true);
        setSecret(data.secret);
        setWinner(data.winner);
      });

      newSocket.on("game_error", (data) => {
        setError(data.message);
        setLoading(false);
      });

      return () => {
        newSocket.disconnect();
      };
    }
  }, [mode]);

  const initGame = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/new-game', { method: 'POST' });
      const data = await res.json();
      setSessionId(data.sessionId);
      setGuesses([]);
      setWin(false);
      setSecret(null);
      setError(null);
      setHintsUsed(0);
      setInputValue('');
      setCooldownRemaining(0);
    } catch (e: any) {
      setError(e.message || 'Failed to initialize game');
    } finally {
      setLoading(false);
    }
  };

  const getMaxHints = (guessCount: number) => {
    return Math.floor(guessCount / 10);
  };

  const joinMultiplayer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameId.trim() || !socket) return;
    setError(null);
    socket.emit("join_game", { gameId: gameId.trim().toUpperCase() });
  };

  const startMultiplayer = () => {
    if (!socket) return;
    socket.emit("start_game", gameId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || (mode === 'multi' && cooldownRemaining > 0)) return;

    if (mode === 'multi') {
      if (!socket || !gameStarted || win) return;
      setLoading(true);
      socket.emit("make_guess", { gameId, word: inputValue.trim() });
      setInputValue('');
      setLastGuessTime(Date.now());
      setCooldownRemaining(10);
      return;
    }

    if (!sessionId || win || loading) return;

    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, word: inputValue.trim() })
      });
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.rank === 1) {
        setWin(true);
        setSecret(data.word);
      }
      
      setGuesses(prev => {
        const next = [{ word: data.word, rank: data.rank, explanation: data.explanation, isLatest: true }, ...prev.map(g => ({ ...g, isLatest: false }))];
        return next;
      });
      
      setInputValue('');
    } catch (e: any) {
      setError(e.message || 'Error making guess');
    } finally {
      setLoading(false);
    }
  };

  const handleHint = async () => {
    if (mode === 'multi') return; 
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
        const next = [{ word: data.hint, rank: data.rank, explanation: data.explanation, isLatest: true }, ...prev.map(g => ({ ...g, isLatest: false }))];
        return next;
      });
    } catch (e: any) {
      setError(e.message || 'Error getting hint');
    } finally {
      setLoading(false);
    }
  };

  const handleGiveUp = async () => {
    if (mode === 'multi' || !sessionId) return;
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
    if (rank <= 500) return 'bg-green-900 border-green-500 text-green-300';
    if (rank <= 1500) return 'bg-yellow-900 border-yellow-500 text-yellow-300';
    return 'bg-red-950 border-red-500 text-red-500';
  };

  const displayGuesses = () => {
    const latest = guesses.find((g: any) => g.isLatest);
    const rest = guesses.filter((g: any) => !g.isLatest).sort((a, b) => a.rank - b.rank);
    if (latest) return [latest, ...rest];
    return rest;
  };

  const renderMultiplayerLobby = () => (
    <div className="bg-indigo-950/40 border border-indigo-500/50 p-6 rounded flex flex-col space-y-4">
      <h2 className="text-2xl font-bold text-indigo-400 uppercase tracking-widest text-center">Multiplayer Nexus</h2>
      {!myNumber ? (
        <div className="space-y-4">
          <form onSubmit={joinMultiplayer} className="flex gap-2">
            <input
              type="text"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="ENTER_ROOM_CODE"
              className="flex-1 bg-black border border-indigo-700/50 rounded px-4 py-3 placeholder-indigo-800 focus:outline-none focus:border-indigo-500 text-xl tracking-widest text-indigo-400 uppercase"
            />
            <button type="submit" disabled={!gameId.trim()} className="px-6 bg-indigo-900/40 border border-indigo-700/50 hover:bg-indigo-800 hover:border-indigo-500 text-indigo-400 rounded transition-all uppercase tracking-widest font-bold disabled:opacity-50">Join</button>
          </form>
          <div className="flex items-center gap-4">
            <div className="h-px bg-indigo-900/50 flex-1"></div>
            <span className="text-indigo-500/50 uppercase tracking-widest text-sm">OR</span>
            <div className="h-px bg-indigo-900/50 flex-1"></div>
          </div>
          <button 
            type="button"
            onClick={() => {
              if (!socket) return;
              const code = Math.random().toString(36).substring(2, 6).toUpperCase();
              setGameId(code);
              socket.emit("join_game", { gameId: code });
            }}
            className="w-full px-6 py-4 bg-indigo-900/40 hover:bg-indigo-800 border border-indigo-500 text-indigo-100 text-xl rounded transition-all uppercase tracking-widest cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.1)] hover:shadow-[0_0_25px_rgba(99,102,241,0.3)]"
          >
            Create New Room
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-xl text-indigo-300 tracking-wider">ROOM: <strong className="text-2xl text-indigo-100">{gameId}</strong></p>
          <div className="space-y-2">
            <p className="text-indigo-400/80 uppercase tracking-wider text-sm">Active Agents ({players.length}/4)</p>
            <div className="flex flex-col gap-2">
              {players.map(p => (
                <div key={p.id} className={`p-3 border ${p.id === socket?.id ? 'border-indigo-400 bg-indigo-900/40 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'border-indigo-900 bg-black'} rounded text-lg uppercase tracking-widest`}>
                  Player {p.number} {p.id === socket?.id && ' (You)'}
                </div>
              ))}
            </div>
          </div>
          <button 
            onClick={startMultiplayer}
            className="w-full mt-4 px-6 py-4 bg-indigo-900/60 hover:bg-indigo-800 border border-indigo-500 text-indigo-100 text-xl rounded transition-all uppercase tracking-widest cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_25px_rgba(99,102,241,0.5)]"
          >
            Commence Simulation
          </button>
        </div>
      )}
      {error && <div className="text-red-400 bg-red-900/20 p-3 rounded">{error}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050505] text-green-400 font-sans p-4 sm:p-8 flex flex-col items-center crt-flicker">
      <div className="scanlines"></div>
      <div className="w-full max-w-xl mx-auto space-y-6 relative z-10">
        <header className="text-center space-y-2 mt-4 mb-8">
          <h1 className="text-6xl sm:text-7xl font-bold text-green-500 flex items-center justify-center gap-3 tracking-widest drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]">
            <span className="text-green-400">[&gt;]</span> MINETEXTO
          </h1>
          <p className="text-green-600/80 text-xl tracking-wider uppercase">Isolate the encoded memory block</p>
        </header>

        {mode === 'menu' && (
          <div className="flex flex-col gap-4 max-w-sm mx-auto mt-12">
            <button 
              onClick={() => { setMode('single'); initGame(); }}
              className="px-6 py-5 border-[3px] border-green-700/50 hover:bg-green-900/40 hover:border-green-500 text-green-400 rounded transition-all flex items-center justify-center uppercase text-2xl tracking-widest gap-3 shadow-[0_0_15px_rgba(34,197,94,0.1)] hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] bg-black"
            >
              <User className="w-6 h-6" /> Single Player
            </button>
            <button 
              onClick={() => setMode('multi')}
              className="px-6 py-5 border-[3px] border-indigo-700/50 hover:bg-indigo-900/40 hover:border-indigo-500 text-indigo-400 rounded transition-all flex items-center justify-center uppercase text-2xl tracking-widest gap-3 shadow-[0_0_15px_rgba(99,102,241,0.1)] hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] bg-black"
            >
              <Users className="w-6 h-6" /> Multiplayer (4P)
            </button>
          </div>
        )}

        {mode === 'multi' && !gameStarted && renderMultiplayerLobby()}

        {(mode === 'single' || (mode === 'multi' && gameStarted)) && (
          <>
            {error && mode === 'single' && (
              <div className="bg-red-900/20 border border-red-500/50 text-red-500 px-4 py-3 rounded flex items-center gap-3">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {gameEnded && mode === 'multi' ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-indigo-950/40 border border-indigo-500 p-6 rounded flex flex-col items-center text-center space-y-5 shadow-[0_0_25px_rgba(99,102,241,0.3)]"
              >
                 <h2 className="text-4xl font-bold text-indigo-400 uppercase tracking-widest">Simulation Ended</h2>
                 <p className="text-xl text-indigo-300 uppercase tracking-wider">The secret was <strong className="text-indigo-100 text-3xl ml-2 animate-pulse">"{secret}"</strong></p>
                 <div className="bg-indigo-900/40 border border-indigo-500/50 p-4 rounded w-full">
                    {winner === null ? (
                      <p className="text-2xl text-yellow-400 uppercase tracking-widest font-bold">Simulation Aborted</p>
                    ) : (
                      <>
                        <p className="text-2xl text-yellow-400 uppercase tracking-widest font-bold">Player {winner} Wins!</p>
                        <p className="text-indigo-200 mt-1 uppercase text-sm">Lowest Guess Count</p>
                      </>
                    )}
                 </div>
                 <div className="flex flex-col gap-3 w-full">
                    {myNumber === 1 ? (
                      <button 
                        onClick={() => socket?.emit("start_game", gameId)}
                        disabled={players.filter(p => p.number !== 1).length > 0 && !players.filter(p => p.number !== 1).every(p => p.rematchVote)}
                        className="w-full px-6 py-3 bg-indigo-600/50 hover:bg-indigo-500 border border-indigo-400 text-indigo-100 text-xl rounded transition-all uppercase tracking-widest disabled:opacity-50"
                      >
                        Start Rematch
                      </button>
                    ) : (
                      <button 
                        onClick={() => socket?.emit("vote_rematch", gameId)}
                        className={`w-full px-6 py-3 border text-xl rounded transition-all uppercase tracking-widest ${players.find(p => p.id === socket?.id)?.rematchVote ? 'bg-indigo-600/50 border-indigo-400 text-indigo-100' : 'bg-transparent border-indigo-500/50 hover:border-indigo-400 text-indigo-300'}`}
                      >
                        {players.find(p => p.id === socket?.id)?.rematchVote ? 'Ready' : 'Vote Rematch'}
                      </button>
                    )}
                    <button 
                      onClick={() => { setMode('menu'); setSocket(null); socket?.disconnect(); setGuesses([]); }}
                      className="w-full px-6 py-3 bg-indigo-900/50 hover:bg-indigo-800 border-2 border-indigo-500 text-indigo-400 text-xl rounded transition-all uppercase tracking-widest"
                    >
                      Return to Main Menu
                    </button>
                 </div>
                 {players.length > 1 && (
                    <p className="text-indigo-400 uppercase tracking-widest text-sm">
                      Ready: {players.filter(p => p.rematchVote || p.number === 1).length}/{players.length}
                    </p>
                 )}
              </motion.div>
            ) : win ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-green-900/30 border border-green-500 p-6 rounded flex flex-col items-center text-center space-y-4 shadow-[0_0_15px_rgba(34,197,94,0.2)]"
              >
                <h2 className="text-3xl font-medium text-green-400 uppercase tracking-widest">Target Isolated</h2>
                <p className="text-xl text-green-600">The sector contained <strong className="text-green-300 text-3xl ml-2 uppercase animate-pulse">"{secret || guesses.find(g => g.rank === 1)?.word}"</strong></p>
                <p className="text-lg text-green-500/80 uppercase tracking-widest">Decrypted in {guesses.length} attempts.</p>
                
                {mode === 'multi' && (
                  <div className="mt-4 border border-indigo-500/30 bg-indigo-900/20 p-4 rounded text-indigo-300 uppercase tracking-widest text-lg animate-pulse w-full">
                    Awaiting other agents...
                  </div>
                )}

                {mode === 'single' && (
                  <button 
                    onClick={initGame}
                    className="mt-4 px-6 py-3 bg-green-900/50 hover:bg-green-800 border-2 border-green-500 text-green-400 text-2xl rounded transition-all inline-flex items-center gap-2 tracking-widest uppercase hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                  >
                    <RefreshCw className="w-6 h-6" /> Reboot System
                  </button>
                )}
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="flex gap-2 relative z-20">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="ENTER_QUERY..."
                  disabled={loading || win || (mode === 'single' && !sessionId) || (mode === 'multi' && cooldownRemaining > 0)}
                  className="flex-1 bg-black border border-green-700/50 rounded px-4 py-3 placeholder-green-800 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all text-3xl tracking-widest disabled:opacity-50 text-green-400 uppercase"
                />
                <button 
                  type="submit" 
                  disabled={loading || !inputValue.trim() || win || (mode === 'single' && !sessionId) || (mode === 'multi' && cooldownRemaining > 0)}
                  className="px-6 bg-green-900/40 border border-green-700/50 hover:bg-green-800 hover:border-green-500 disabled:bg-black disabled:text-green-900 text-green-400 rounded transition-all flex items-center justify-center uppercase disabled:opacity-50 min-w-[80px]"
                >
                  {mode === 'multi' && cooldownRemaining > 0 ? (
                    <span className="text-2xl font-bold">{cooldownRemaining}s</span>
                  ) : loading ? (
                    <Loader2 className="w-8 h-8 animate-spin" />
                  ) : (
                    <ArrowRight className="w-8 h-8" />
                  )}
                </button>
              </form>
            )}

            <div className="flex justify-between items-center py-2 border-b border-green-900/50 pb-4">
              <span className="text-green-600/80 text-xl tracking-widest uppercase">Scans: {guesses.length}</span>
              
              <div className="flex items-center gap-4">
                {mode === 'single' && !win && guesses.length > 0 && (
                  <button
                    onClick={handleGiveUp}
                    className="text-red-600/60 hover:text-red-500 transition-colors uppercase tracking-widest text-lg"
                  >
                    Abort
                  </button>
                )}
                {mode === 'multi' && gameStarted && !win && !gameEnded && guesses.length > 0 && (
                  <button
                    onClick={() => socket?.emit("vote_abort", gameId)}
                    className={`transition-colors uppercase tracking-widest text-lg ${players.find(p => p.id === socket?.id)?.abortVote ? 'text-red-500 font-bold' : 'text-red-600/60 hover:text-red-500'}`}
                  >
                    Abort ({players.filter(p => p.abortVote).length}/{players.length})
                  </button>
                )}
                {mode === 'single' && !win && getMaxHints(guesses.length) - hintsUsed > 0 && (
                  <button
                    onClick={handleHint}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-900/40 border border-green-500/50 text-green-400 hover:bg-green-800 hover:border-green-500 rounded transition-all disabled:opacity-50 text-xl uppercase tracking-widest"
                  >
                    <HelpCircle className="w-5 h-5" /> 
                    Ping ({getMaxHints(guesses.length) - hintsUsed})
                  </button>
                )}
                {mode === 'multi' && (
                  <span className="text-indigo-400/80 uppercase tracking-widest text-lg border border-indigo-900/50 px-2 py-1 rounded bg-indigo-950/20">
                    P{myNumber}
                  </span>
                )}
              </div>
            </div>

            {mode === 'multi' && players.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {players.map(p => (
                  <div key={p.id} className={`p-2 border ${p.id === socket?.id ? 'border-indigo-500 bg-indigo-900/20' : 'border-indigo-900/30 bg-black'} rounded text-center`}>
                    <p className="text-xs text-indigo-400/70 uppercase tracking-widest">Player {p.number}</p>
                    <p className="text-xl text-indigo-300 font-bold tracking-widest mt-1">{p.guessCount}</p>
                    {p.finished && <p className="text-green-400 text-xs animate-pulse uppercase tracking-widest mt-1">Done!</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3 pb-8">
              <AnimatePresence>
                {displayGuesses().map((g: any, i) => (
                  <motion.div 
                    key={g.word + i}
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    layout
                    className={`relative overflow-hidden rounded w-full flex flex-col px-4 py-3 border-l-4 ${getColorClass(g.rank)} ${g.isLatest ? 'shadow-[0_0_10px_rgba(255,255,255,0.1)] bg-green-900/10' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        {g.isLatest ? (
                          <span className="text-sm tracking-widest text-green-300 opacity-80 shrink-0 uppercase border border-green-500/30 px-1 rounded bg-black">Last</span>
                        ) : (
                          <span className="w-10"></span>
                        )}
                        <span className="tracking-widest uppercase truncate mr-4 text-2xl">
                          {g.word}
                        </span>
                      </div>
                      <span className="opacity-90 text-3xl tracking-widest font-bold">
                        {g.rank.toLocaleString()}
                      </span>
                    </div>
                    {((mode === 'single' && win) || (mode === 'multi' && gameEnded)) && g.explanation && (
                      <div className="mt-2 text-sm text-green-300/80 italic pl-14">
                        ↳ {g.explanation}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {guesses.length === 0 && !loading && !win && (
                <div className="text-center text-green-800 py-16 px-4 uppercase tracking-widest border border-dashed border-green-900/50 rounded-lg">
                  Awaiting payload... Scan sequence offline.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
