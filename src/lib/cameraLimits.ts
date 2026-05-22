/** Maximum cameras per account (global across all detection workspaces). */
export const MAX_CAMERAS = 5;

export function canAddMoreCameras(currentCount: number): boolean {
  return currentCount < MAX_CAMERAS;
}

export const MAX_CAMERAS_MESSAGE = `You can add up to ${MAX_CAMERAS} cameras. Remove one to add another.`;
