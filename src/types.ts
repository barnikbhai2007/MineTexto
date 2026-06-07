export interface GuessRequest {
  sessionId: string;
  word: string;
}

export interface GuessResponse {
  word: string;
  rank: number;
}

export interface HintRequest {
  sessionId: string;
}

export interface HintResponse {
  hint: string;
  rank: number;
}
