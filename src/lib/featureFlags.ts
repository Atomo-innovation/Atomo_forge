/** Set to `true` when the Events sidebar tab and screen should be visible again. */
export const EVENTS_TAB_ENABLED = false;

/** Set to `true` to show the Key metrics panel on the Overview home screen. */
export const OVERVIEW_KPIS_ENABLED = false;

/** Built-in detection sidebar tabs (Person, Fire & smoke, Face, Safety). */
export const BUILTIN_WORKSPACE_ENABLED = {
  cameras: true,
  cameras2: false,
  cameras3: false,
  cameras4: false,
} as const;

export type BuiltinWorkspaceId = keyof typeof BUILTIN_WORKSPACE_ENABLED;

export function isBuiltinWorkspaceEnabled(workspaceId: string): boolean {
  if (workspaceId in BUILTIN_WORKSPACE_ENABLED) {
    return BUILTIN_WORKSPACE_ENABLED[workspaceId as BuiltinWorkspaceId];
  }
  return true;
}

/** Sidebar / routing: block navigation to disabled built-in detection views. */
export function isDetectionViewEnabled(view: string): boolean {
  if (view in BUILTIN_WORKSPACE_ENABLED) {
    return BUILTIN_WORKSPACE_ENABLED[view as BuiltinWorkspaceId];
  }
  return true;
}
