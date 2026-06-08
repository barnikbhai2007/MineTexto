import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Groq from "groq-sdk";
import crypto from "crypto";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateWithRetry(prompt: string, fallbackText: string, maxRetries = 3) {
  let delay = 2000;
  const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"];
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const model of models) {
      try {
        const chatCompletion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model,
        });
        return { text: chatCompletion.choices[0]?.message?.content || fallbackText };
      } catch (error: any) {
        console.error(`Error with model ${model} on attempt ${attempt + 1}:`, error.message);
        // If it's auth/invalid key, we might surface it, but let's just continue
      }
    }
    console.log(`All models failed on attempt ${attempt + 1}. Waiting ${delay}ms...`);
    await new Promise(res => setTimeout(res, delay));
    delay *= 2;
  }
  
  // Create a mock fallback response if all AI calls fail (e.g., quota exceeded)
  return {
    text: fallbackText
  };
}

const app = express();
app.use(express.json());
const PORT = 3000;

// Hardcoded Minecraft terms
const MINECRAFT_TERMS = [
  "Diamond Pickaxe", "Iron Sword", "Bow", "Trident", "Netherite Chestplate",
  "Dirt", "Cobblestone", "Obsidian", "Bedrock", "Glowstone", "Slime Block", "Diamond Ore",
  "Creeper", "Zombie", "Enderman", "Ender Dragon", "Pig", "Villager", "Wither", "Iron Golem",
  "Ender Pearl", "Redstone Dust", "Diamond", "Nether Star", "Totem of Undying", "Golden Apple", "Blaze Rod",
  "Plains", "Desert", "Nether Wastes", "The End", "Deep Dark", "Mushroom Fields",
  "Potion of Healing", "Potion of Swiftness", "Potion of Invisibility", "Splash Potion of Weakness"
];

// In-memory session store
interface Session {
  secret: string;
  guesses: Record<string, { rank: number, explanation: string }>;
}
const sessions = new Map<string, Session>();

// helper to clean word
const normalize = (w: string) => w.trim().toLowerCase();

app.post("/api/new-game", (req, res) => {
  const sessionId = crypto.randomUUID();
  const secret = MINECRAFT_TERMS[Math.floor(Math.random() * MINECRAFT_TERMS.length)].toLowerCase();
  sessions.set(sessionId, { secret, guesses: {} });
  res.json({ sessionId });
});

app.post("/api/guess", async (req, res) => {
  try {
    const { sessionId, word } = req.body;
    if (!sessionId || !word) return res.status(400).json({ error: "Missing sessionId or word" });
    
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const normWord = normalize(word);
    const normSecret = normalize(session.secret);

    // If already guessed, return cached
    if (session.guesses[normWord] !== undefined) {
      return res.json({ word: normWord, rank: session.guesses[normWord].rank, explanation: session.guesses[normWord].explanation });
    }

    if (normWord === normSecret) {
      session.guesses[normWord] = { rank: 1, explanation: "Correct guess!" };
      return res.json({ word: normWord, rank: 1, explanation: session.guesses[normWord].explanation });
    }

    // Build context string from history to maintain consistency
    const sortedGuesses = Object.entries(session.guesses).sort((a, b) => a[1].rank - b[1].rank);
    const previousGuessesStr = sortedGuesses.map(([w, data]) => `${w}: ${data.rank}`).join("\n");

    const prompt = `You are an expert Minecraft game scoring system for a Contexto adaptation.
The secret Minecraft term the player is trying to guess is: "${session.secret}"
The player just guessed: "${normWord}"

You must assign a numerical rank from 1 to 32000 indicating semantic and conceptual similarity within the universe of Minecraft.
Rules for ranks:
1: The guess is an exact match or an extremely close synonym for the secret word.
2-500: Extremely closely related (same category, crafted from it, heavily associated, strong lore connection).
501-1000: Somewhat related (similar item type, loosely associated).
1001-32000: Progressively less related to completely unrelated.

CRITICAL: Do NOT output perfectly round numbers (e.g., avoid 500, 1000). Generate precise, random-looking granular numbers (e.g., 478, 13498).

Previous guesses and their ranks in this session for context:
${previousGuessesStr || "None"}

Output ONLY valid JSON payload with "rank" and a short "explanation" of why it got this rank relative to the secret. No markdown or other text.
{"rank": 1234, "explanation": "Short sentence explaining the relationship."}`;

    const response = await generateWithRetry(prompt, '{"rank": 15000, "explanation": "Unknown"}');

    let rank = 15000;
    let explanation = "Could not evaluate.";
    try {
      // Find JSON block if it has markdown
      const match = response.text?.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        rank = parsed.rank;
        explanation = parsed.explanation || explanation;
      }
    } catch(e) {}
    
    if (isNaN(rank)) {
      rank = 15000;
    } else if (rank <= 1) {
      rank = 2; // don't award 1 unless exactly matched above
    } else if (rank > 32000) {
      rank = 32000;
    }

    session.guesses[normWord] = { rank, explanation };
    res.json({ word: normWord, rank, explanation });
  } catch (error) {
    console.error("Error making guess:", error);
    res.status(500).json({ error: "Failed to process guess" });
  }
});

app.post("/api/hint", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
    
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const sortedGuesses = Object.entries(session.guesses).sort((a, b) => a[1].rank - b[1].rank);
    const bestGuess = sortedGuesses.length > 0 ? sortedGuesses[0] : null;

    const prompt = `You are providing a hint for a Minecraft Contexto game.
The secret Minecraft term is: "${session.secret}"
${bestGuess ? `The player's best guess so far is "${bestGuess[0]}" with a rank of ${bestGuess[1].rank}.` : "The player has no good guesses yet."}

Provide ONE Minecraft-related word or short phrase that is conceptually closer to the secret word than the player's best guess.
DO NOT reveal the exact secret word.
Output ONLY the hint word or phrase. No markdown, no explanations.`;

    const response = await generateWithRetry(prompt, "Dirt");

    let hint = response.text?.trim() || "Dirt"; // fallback

    let hintRank = 1500;
    if (bestGuess && bestGuess[1].rank > 2) {
      hintRank = Math.floor(bestGuess[1].rank / 2);
    }

    const normHint = normalize(hint);
    if (session.guesses[normHint] === undefined) {
      session.guesses[normHint] = { rank: hintRank, explanation: "Generated as a hint." };
    } else {
      hintRank = session.guesses[normHint].rank;
    }

    res.json({ hint: normHint, rank: hintRank, explanation: session.guesses[normHint].explanation });
  } catch (error) {
    console.error("Error generating hint:", error);
    res.status(500).json({ error: "Failed to generate hint" });
  }
});

app.get("/api/giveup", (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ secret: session.secret });
});

async function startServer() {
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" }
  });

  const games = new Map<string, any>();

  io.on("connection", (socket) => {
    socket.on("join_game", ({ gameId, username }) => {
      let game = games.get(gameId);
      if (!game) {
        // Create new game
        const secret = MINECRAFT_TERMS[Math.floor(Math.random() * MINECRAFT_TERMS.length)].toLowerCase();
        game = {
          id: gameId,
          secret,
          players: [],
          started: false,
          finished: false
        };
        games.set(gameId, game);
      }
      
      if (game.started || game.players.length >= 4) {
        socket.emit("game_error", { message: game.started ? "Game already started" : "Game full (max 4 players)" });
        return;
      }

      const player = {
        id: socket.id,
        number: game.players.length + 1,
        guesses: [],
        guessCount: 0,
        finished: false,
        abortVote: false,
        rematchVote: false
      };
      game.players.push(player);
      socket.join(gameId);
      
      io.to(gameId).emit("game_updated", {
        players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished, abortVote: p.abortVote, rematchVote: p.rematchVote })),
        started: game.started,
        gameId
      });
    });

    socket.on("start_game", (gameId) => {
      const game = games.get(gameId);
      if (!game) return;
      const player = game.players.find((p: any) => p.id === socket.id);
      
      // Only player 1 (admin) can start or restart
      if (player && player.number === 1) {
        if (game.finished) {
          // It's a rematch. Check if others are ready.
          const othersReady = game.players.filter((p: any) => p.number !== 1).every((p: any) => p.rematchVote);
          if (!othersReady && game.players.length > 1) return;
          
          game.secret = MINECRAFT_TERMS[Math.floor(Math.random() * MINECRAFT_TERMS.length)].toLowerCase();
          game.finished = false;
          game.started = true;
          game.players.forEach((p: any) => {
            p.guesses = [];
            p.guessCount = 0;
            p.finished = false;
            p.abortVote = false;
            p.rematchVote = false;
          });
          io.to(gameId).emit("game_restarted");
        } else if (!game.started) {
          game.started = true;
          io.to(gameId).emit("game_started");
        }
        
        io.to(gameId).emit("game_updated", {
          players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished, abortVote: p.abortVote, rematchVote: p.rematchVote })),
          started: game.started,
          gameId
        });
      }
    });

    socket.on("vote_abort", (gameId) => {
      const game = games.get(gameId);
      if (!game || !game.started || game.finished) return;
      const player = game.players.find((p: any) => p.id === socket.id);
      if (!player) return;

      player.abortVote = !player.abortVote;
      
      io.to(gameId).emit("game_updated", {
        players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished, abortVote: p.abortVote, rematchVote: p.rematchVote })),
        started: game.started,
        gameId
      });

      if (game.players.every((p: any) => p.abortVote)) {
        game.finished = true;
        io.to(gameId).emit("game_ended", {
          secret: game.secret,
          winner: null // Represents aborted game
        });
      }
    });

    socket.on("vote_rematch", (gameId) => {
      const game = games.get(gameId);
      if (!game) return;
      const player = game.players.find((p: any) => p.id === socket.id);
      if (!player) return;

      player.rematchVote = !player.rematchVote;
      
      io.to(gameId).emit("game_updated", {
        players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished, abortVote: p.abortVote, rematchVote: p.rematchVote })),
        started: game.started,
        gameId
      });
    });

    socket.on("make_guess", async ({ gameId, word }) => {
      const game = games.get(gameId);
      if (!game || !game.started) return;
      const player = game.players.find((p: any) => p.id === socket.id);
      if (!player || player.finished) return;

      const normWord = normalize(word);
      if (!normWord) return;

      // Ensure no duplicate guesses
      if (player.guesses.some((g: any) => g.word === normWord)) return;

      player.guessCount += 1;

      // If correct
      if (normWord === game.secret) {
        player.finished = true;
        player.guesses.push({ word: normWord, rank: 1, explanation: "Correct guess!" });
        socket.emit("guess_result", { word: normWord, rank: 1, explanation: "Correct guess!" });
        
        io.to(gameId).emit("game_updated", {
          players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished })),
          started: game.started,
          gameId
        });

        if (game.players.every((p: any) => p.finished)) {
          game.finished = true;
          io.to(gameId).emit("game_ended", {
            secret: game.secret,
            winner: [...game.players].sort((a: any, b: any) => a.guessCount - b.guessCount)[0].number
          });
        }
        return;
      }

      // If incorrect, prompt AI
      let aiPrompt = `You are an expert Minecraft game scoring system for a Contexto adaptation.
The secret Minecraft term the player is trying to guess is: "${game.secret}"
The player just guessed: "${normWord}"

You must assign a numerical rank from 1 to 32000 indicating semantic similarity.
Output ONLY valid JSON payload with "rank" and a short "explanation" of why it got this rank relative to the secret. No markdown or other text.
{"rank": 1234, "explanation": "Short sentence explaining the relationship."}`;
      
      const response = await generateWithRetry(aiPrompt, '{"rank": 15000, "explanation": "Unknown"}');
      let rank = 15000;
      let explanation = "Could not evaluate.";
      try {
        const match = response.text?.match(/\{[\s\S]*?\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          rank = parsed.rank;
          explanation = parsed.explanation || explanation;
        }
      } catch(e) {}
      
      if (isNaN(rank) || rank <= 1) rank = 15000;

      player.guesses.push({ word: normWord, rank, explanation });
      socket.emit("guess_result", { word: normWord, rank, explanation });
      
      io.to(gameId).emit("game_updated", {
        players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished })),
        started: game.started,
        gameId
      });
    });

    socket.on("disconnect", () => {
      // Find game for player
      for (const [gameId, game] of games.entries()) {
        const idx = game.players.findIndex((p: any) => p.id === socket.id);
        if (idx !== -1) {
          game.players.splice(idx, 1);
          if (game.players.length === 0) {
            games.delete(gameId);
          } else {
            // Reassign numbers
            game.players.forEach((p: any, i: number) => { p.number = i + 1; });
            io.to(gameId).emit("game_updated", {
              players: game.players.map((p: any) => ({ id: p.id, number: p.number, guessCount: p.guessCount, finished: p.finished })),
              started: game.started,
              gameId
            });
          }
          break;
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.VERCEL) {
    // Vercel serverless environment doesn't use the httpServer
    module.exports = app;
  } else {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
