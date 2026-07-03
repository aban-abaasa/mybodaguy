// Re-export the app-wide singleton so there is only ever one GoTrueClient
// instance in the browser. This file used to create its own client with a
// separate storage key, which silently split auth sessions from the rest
// of the app (e.g. login here was invisible to the wallet/dashboard screens).
export { supabase } from '../../services/supabaseClient';
