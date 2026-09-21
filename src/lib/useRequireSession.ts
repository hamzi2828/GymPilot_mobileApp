// "You have to be signed in to see this."
//
// Every screen with a member's data on it calls this. When the session ends
// while the screen is up -- the member signed out, or the server refused the
// token -- the screen sends them to sign in. Only the screen the member is
// actually looking at does the sending: hanging it off focus rather than off
// render means a check-in code open over the tabs does not race the tabs
// underneath it to the same destination.

import { useCallback } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useSession } from "./session";

export function useRequireSession() {
  const { ready, session } = useSession();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (ready && !session) router.replace("/login");
    }, [ready, session, router])
  );

  return { ready, session };
}
