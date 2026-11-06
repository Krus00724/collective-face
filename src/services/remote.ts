import { createClient, type Session } from '@supabase/supabase-js';
import { useStore } from '../store';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

/** Noticed before the client tidies the address: this visit began at the link in an e-mail. */
const fromLink = location.hash.includes('access_token=');

/** The public site's backend. Absent in the artifact, which has its own database. */
export const remote = url && key
  ? createClient(url, key, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  : null;

/** Hashed in the browser, so the code a visitor keeps never reaches the server. */
export async function hashCode(code: string) {
  const clean = code.replace(/[^0-9a-z]/gi, '').toUpperCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function publish(session: Session | null) {
  const email = session?.user.email ?? null;
  useStore.getState().set({ account: email ? { email } : null });
  if (!remote || !session) { useStore.getState().set({ owner: false }); return; }
  const { data } = await remote.from('owners').select('user_id').maybeSingle();
  useStore.getState().set({ owner: !!data });
}

/** Follows who is signed in. Only people adding a portrait, and the artist, ever are. */
export function watchAccount() {
  if (!remote) return;
  remote.auth.getSession().then(({ data }) => {
    publish(data.session);
    if (fromLink && data.session) {
      let next: string | null = null;
      try { next = localStorage.getItem('cf-after-link'); localStorage.removeItem('cf-after-link'); } catch { /* none */ }
      if (next === 'review') useStore.getState().go('review');
      else {
        useStore.getState().go('studio');
        useStore.getState().set({ libraryOpen: true });
      }
    }
  });
  remote.auth.onAuthStateChange((_, session) => { setTimeout(() => publish(session), 0); });
}

export interface LibraryPortrait { id: string; src: string; keep: boolean }

export async function loadLibrary() {
  if (!remote) return;
  const { data, error } = await remote.from('portraits').select('id, path, keep, created_at').order('created_at', { ascending: false }).limit(500);
  if (error || !data) return;
  const library: LibraryPortrait[] = data.map((row) => ({
    id: `lib-${row.id}`,
    src: remote!.storage.from('portraits').getPublicUrl(row.path).data.publicUrl,
    keep: row.keep,
  }));
  useStore.getState().set({ library });
}

export interface Reply { error?: string; retake?: string; portrait?: { id: string; path: string } | null; done?: boolean }

/** Everything that touches the library goes through one server function, signed in. */
export async function library(body: Record<string, unknown>): Promise<Reply> {
  if (!remote) return { error: 'The library is not available here.' };
  const { data, error } = await remote.functions.invoke('portraits', { body });
  if (!error) return data as Reply;
  const context = (error as { context?: Response }).context;
  try {
    if (context) return (await context.json()) as Reply;
  } catch { /* falls through */ }
  return { error: 'The library could not be reached. Try again in a moment.' };
}

export const portraitUrl = (path: string) => remote?.storage.from('portraits').getPublicUrl(path).data.publicUrl ?? '';
