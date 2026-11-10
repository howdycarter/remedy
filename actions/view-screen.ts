import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Read what the user is looking at: the current navigation state and, when the Remedy studio has a page open, that page's label, score, and open findings with their drafted fixes. Basic navigation is already included in <current-screen>; use this action when you need a fresh read.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    // What the Remedy studio is showing right now: page, score and open findings.
    const studio = await readAppState("remedy-studio");
    if (studio) {
      screen.remedyStudio = studio;
      screen.hint =
        "The user has this page open in the Remedy studio. Call get-studio-document for its HTML; pass updateStudio: true to apply-fix so an approved fix appears on their screen.";
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
