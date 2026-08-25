/**
 * Chat history persistence.
 *
 * Stores chat sessions in AsyncStorage for the sidebar.
 * Each chat has an id, title, messages, and timestamps.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHATS_KEY = '@sunlight_chats';
const MESSAGES_KEY = '@sunlight_messages';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}


export async function loadChats(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(CHATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveChats(chats: ChatSession[]): Promise<void> {
  await AsyncStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export async function createChat(id: string, title: string): Promise<ChatSession> {
  const chats = await loadChats();
  const chat: ChatSession = {
    id,
    title,
    createdAt: Date.now(),
    messageCount: 0,
  };
  await saveChats([chat, ...chats]);
  return chat;
}

export async function updateChat(
  id: string,
  updates: Partial<ChatSession>,
): Promise<void> {
  const chats = await loadChats();
  const idx = chats.findIndex(c => c.id === id);
  if (idx >= 0) {
    chats[idx] = {...chats[idx], ...updates};
    await saveChats(chats);
  }
}

export async function deleteChat(id: string): Promise<void> {
  const chats = await loadChats();
  await saveChats(chats.filter(c => c.id !== id));
  await AsyncStorage.removeItem(`${MESSAGES_KEY}:${id}`);
}


export async function loadMessages(chatId: string): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(`${MESSAGES_KEY}:${chatId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveMessages(
  chatId: string,
  messages: ChatMessage[],
): Promise<void> {
  await AsyncStorage.setItem(`${MESSAGES_KEY}:${chatId}`, JSON.stringify(messages));
}

export async function appendMessage(
  chatId: string,
  message: ChatMessage,
): Promise<ChatMessage[]> {
  const msgs = await loadMessages(chatId);
  msgs.push(message);
  await saveMessages(chatId, msgs);
  return msgs;
}


/** Generate a title from the first user message. */
export function generateTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 40) + '...';
}

/** Generate a unique chat ID. */
export function generateChatId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
