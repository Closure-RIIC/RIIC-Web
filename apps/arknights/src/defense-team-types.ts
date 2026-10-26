import type {
  DefenseFaction,
  DefensePortrait,
  TeamPreferences,
} from "./defense-team-validation";

export type DefenseRoomMember = {
  name: string;
  portrait: DefensePortrait;
  seat: number;
  isReady: boolean;
  isHost: boolean;
  isMe: boolean;
  favoriteFactions: DefenseFaction[];
};
export type DefenseRoom = TeamPreferences & {
  id: string;
  title: string;
  server: string;
  note: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  isHost: boolean;
  joined: boolean;
  roomCode: string | null;
  inviteCode: string;
  members: DefenseRoomMember[];
};
